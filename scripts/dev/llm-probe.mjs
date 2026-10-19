// Tool-calling probe for an OpenAI-compatible LLM provider. It sends the gateway's 15-tool catalogue
// (apps/gateway/test/fixtures/gateway-tools.json, descriptions trimmed) plus a system prompt draft and
// asks two questions. Tools are NOT executed; only the model's first tool call is checked.
// Usage: node scripts/dev/llm-probe.mjs --provider groq|openrouter --model <id> [--runs 3]
//          [--effort low|medium|high] [--cap 300]
// Keys are read from the git-ignored .env (or the environment) and are never printed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const provider = argValue('--provider');
const model = argValue('--model');
const runs = Number(argValue('--runs', '1'));
const effort = argValue('--effort');
const cap = Number(argValue('--cap', '300'));

const PROVIDERS = {
  groq: { baseUrl: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY', minGapMs: 2500 },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY', minGapMs: 3500 },
};
const p = PROVIDERS[provider];
if (!p || !model || !Number.isInteger(runs) || runs < 1) {
  console.error('usage: node scripts/dev/llm-probe.mjs --provider groq|openrouter --model <id> [--runs N] [--effort low|medium|high] [--cap 300]');
  process.exit(1);
}

/** Reads KEY=value lines from the repo-root .env without echoing anything. */
function loadDotEnv() {
  const out = {};
  try {
    const text = readFileSync(fileURLToPath(new URL('../../.env', import.meta.url)), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch {
    // no .env: the process environment may still have the key
  }
  return out;
}
const apiKey = process.env[p.keyEnv] || loadDotEnv()[p.keyEnv] || '';
if (!apiKey) {
  console.error(`${p.keyEnv}: empty (set it in .env)`);
  process.exit(1);
}
console.log(`${p.keyEnv}: set`);

const catalogue = JSON.parse(readFileSync(fileURLToPath(new URL('../../apps/gateway/test/fixtures/gateway-tools.json', import.meta.url)), 'utf8'));
const tools = catalogue.map((t) => ({
  type: 'function',
  function: { name: t.name, description: t.description.slice(0, cap), parameters: t.inputSchema },
}));

const SYSTEM = [
  'You are the store assistant for a WooCommerce shop. You act only through the provided tools.',
  'Use a tool whenever the user asks about orders, products or notes; never invent data.',
  'For write actions (creating products, changing order status) call the tool directly with the details the user gave.',
  'New products are created as drafts unless the user says otherwise.',
  'Be brief and answer in plain text after the tools return.',
].join(' ');

const QUESTIONS = [
  {
    id: 'Q1',
    text: 'What orders came in today?',
    check: (name, a) => name === 'woo__list_orders' && a.period === 'today',
  },
  {
    id: 'Q2',
    text: 'Create a draft product called Probe Mug priced 12.50.',
    check: (name, a) =>
      name === 'woo__create_product' && typeof a.name === 'string' && /probe mug/i.test(a.name) && Number(a.regular_price) === 12.5 && a.status === 'draft',
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastRequestAt = 0;

async function ask(question) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = lastRequestAt + p.minGapMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    const res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: question.text },
        ],
        tools,
        tool_choice: 'auto',
        temperature: 0.2,
        max_completion_tokens: 2048,
        ...(effort ? { reasoning_effort: effort } : {}),
      }),
    });
    if (res.status === 429) {
      const after = Math.min(Math.max(Number(res.headers.get('retry-after')) || 10, 1), 90);
      console.log(`  429: waiting ${after}s`);
      await sleep(after * 1000 + 500);
      continue;
    }
    const text = await res.text();
    if (!res.ok) {
      let code = '';
      try {
        const c = JSON.parse(text)?.error?.code;
        if (typeof c === 'string' && /^[a-z_]{1,40}$/.test(c)) code = c;
      } catch {
        // ignore
      }
      return { status: res.status, code };
    }
    return { status: 200, body: JSON.parse(text) };
  }
  return { status: 429, code: 'gave_up' };
}

let correct = 0;
let total = 0;
const sums = { prompt: 0, completion: 0, total: 0 };
for (let run = 1; run <= runs; run++) {
  for (const q of QUESTIONS) {
    total++;
    const r = await ask(q);
    const prefix = `${model} run${run} ${q.id}${effort ? ` effort=${effort}` : ''}`;
    if (r.status !== 200) {
      console.log(`${prefix}: HTTP ${r.status}${r.code ? ` (${r.code})` : ''}`);
      continue;
    }
    const msg = r.body.choices?.[0]?.message;
    const call = msg?.tool_calls?.[0];
    const u = r.body.usage ?? {};
    let argsOk = false;
    let ok = false;
    if (call) {
      try {
        const parsed = JSON.parse(call.function.arguments);
        argsOk = true;
        ok = q.check(call.function.name, parsed);
      } catch {
        argsOk = false;
      }
    }
    if (ok) correct++;
    sums.prompt += u.prompt_tokens ?? 0;
    sums.completion += u.completion_tokens ?? 0;
    sums.total += u.total_tokens ?? 0;
    console.log(
      `${prefix}: tool=${call?.function?.name ?? '(none)'} args_parse=${argsOk} correct=${ok} tokens=${u.prompt_tokens ?? '?'}/${u.completion_tokens ?? '?'}/${u.total_tokens ?? '?'} (prompt/completion/total)`,
    );
  }
}
console.log(`SUMMARY ${provider} ${model}${effort ? ` effort=${effort}` : ''} cap=${cap}: correct ${correct}/${total}, tokens prompt=${sums.prompt} completion=${sums.completion} total=${sums.total}`);
