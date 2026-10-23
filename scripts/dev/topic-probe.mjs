// Topic-check probe: sends each case in apps/gateway/test/fixtures/topic-probe-cases.json to Groq exactly as the
// gateway's topic check does and prints ALLOW/BLOCK per case.
// The system prompt, the input builder and the output cap are imported from the gateway build output, so the probe
// measures what production sends: build first with `npm run build -w @urumi/gateway`.
// Request parameters match production: temperature 0, reasoning_effort low (gpt-oss), the gateway's output cap.
// Usage: node scripts/dev/topic-probe.mjs [--model openai/gpt-oss-20b] [--runs 1] [--effort low] [--max <cap>]
// The key is read from the git-ignored .env (or the environment) inside this process only and never printed.
// Output has no prompt text and no model text: only the one-word verdict, or EMPTY (no text, for example when
// reasoning used the whole cap) or UNPARSED (some other text). Production allows both; for a BLOCK case they fail.
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const fromRoot = (rel) => fileURLToPath(new URL(`../../${rel}`, import.meta.url));

// The gateway's own code, from the build output (stale or missing output is refused).
const built = 'apps/gateway/dist/chat/topicCheck.js';
const sources = ['apps/gateway/src/chat/topicCheck.ts', 'apps/gateway/src/chat/llm/registry.ts'];
let builtAt;
try {
  builtAt = statSync(fromRoot(built)).mtimeMs;
} catch {
  console.error(`${built} is missing: run npm run build -w @urumi/gateway first`);
  process.exit(1);
}
if (sources.some((s) => statSync(fromRoot(s)).mtimeMs > builtAt)) {
  console.error(`${built} is older than its source: run npm run build -w @urumi/gateway first`);
  process.exit(1);
}
const { buildTopicInput, TOPIC_SYSTEM_PROMPT } = await import(new URL(`../../${built}`, import.meta.url).href);
const { TOPIC_CHECK_MAX_OUTPUT_TOKENS } = await import(new URL('../../apps/gateway/dist/chat/llm/registry.js', import.meta.url).href);

const model = argValue('--model', 'openai/gpt-oss-20b');
const runs = Number(argValue('--runs', '1'));
const effort = argValue('--effort', 'low');
const maxTokens = Number(argValue('--max', String(TOPIC_CHECK_MAX_OUTPUT_TOKENS)));
const BASE_URL = 'https://api.groq.com/openai/v1';
const KEY_ENV = 'GROQ_API_KEY';
const MIN_GAP_MS = 2500;

/** Reads KEY=value lines from the repo-root .env without echoing anything. */
function loadDotEnv() {
  const out = {};
  try {
    const text = readFileSync(fromRoot('.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch {
    // no .env: the process environment may still have the key
  }
  return out;
}
const apiKey = process.env[KEY_ENV] || loadDotEnv()[KEY_ENV] || '';
if (!apiKey) {
  console.error(`${KEY_ENV}: empty (set it in .env)`);
  process.exit(1);
}
console.log(`${KEY_ENV}: set`);

if (args.includes('--list-models')) {
  // Prints model ids only (useful when a model is not enabled for the account).
  const res = await fetch(`${BASE_URL}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
  const body = await res.json().catch(() => ({}));
  console.log(`HTTP ${res.status}`);
  for (const m of body.data ?? []) if (typeof m.id === 'string' && /^[\w./:-]{1,80}$/.test(m.id)) console.log(m.id);
  setTimeout(() => process.exit(0), 100);
  await new Promise(() => {});
}

const cases = JSON.parse(readFileSync(fromRoot('apps/gateway/test/fixtures/topic-probe-cases.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastRequestAt = 0;
const headerNums = {};

/** The history the dashboard would send for this case: the previous assistant message, when there is one, then the user's. */
const historyOf = (c) => [...(c.previousAssistant ? [{ role: 'assistant', content: c.previousAssistant }] : []), { role: 'user', content: c.user }];

async function ask(c) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = lastRequestAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: TOPIC_SYSTEM_PROMPT },
          { role: 'user', content: buildTopicInput(historyOf(c)) },
        ],
        temperature: 0,
        max_completion_tokens: maxTokens,
        ...(effort ? { reasoning_effort: effort } : {}),
      }),
    });
    for (const h of ['x-ratelimit-limit-requests', 'x-ratelimit-limit-tokens', 'x-ratelimit-remaining-requests', 'x-ratelimit-remaining-tokens']) {
      const raw = res.headers.get(h);
      if (raw !== null && Number.isFinite(Number(raw))) headerNums[h] = Number(raw);
    }
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
    const out = String(JSON.parse(text).choices?.[0]?.message?.content ?? '').trim();
    // The same first-word rule as checkTopic.
    const first = out.split(/\s+/)[0]?.toUpperCase().replace(/[^A-Z]/g, '') ?? '';
    const verdict = out === '' ? 'EMPTY' : first === 'BLOCK' || first === 'ALLOW' ? first : 'UNPARSED';
    return { status: 200, verdict };
  }
  return { status: 429 };
}

for (let run = 1; run <= runs; run++) {
  let allowOk = 0;
  let allowN = 0;
  let blockOk = 0;
  let blockN = 0;
  let errors = 0;
  let empty = 0;
  console.log(`--- run ${run} model=${model}${effort ? ` effort=${effort}` : ''} max=${maxTokens} temperature=0`);
  console.log('case expected got result');
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const r = await ask(c);
    if (c.expected === 'ALLOW') allowN++;
    else blockN++;
    if (r.status !== 200) {
      errors++;
      console.log(`${String(i + 1).padStart(2)} ${c.expected} HTTP-${r.status}${r.code ? `(${r.code})` : ''} FAIL`);
      if (errors >= 3) {
        console.log('stopping run: repeated HTTP errors');
        break;
      }
      continue;
    }
    if (r.verdict === 'EMPTY') empty++;
    // Production allows anything that is not BLOCK (fail open), so EMPTY and UNPARSED pass an ALLOW case and fail a BLOCK case.
    const ok = c.expected === 'BLOCK' ? r.verdict === 'BLOCK' : r.verdict !== 'BLOCK';
    if (ok) {
      if (c.expected === 'ALLOW') allowOk++;
      else blockOk++;
    }
    console.log(`${String(i + 1).padStart(2)} ${c.expected} ${r.verdict} ${ok ? 'pass' : 'FAIL'}`);
  }
  console.log(`TOTAL run ${run}: allowed ${allowOk}/${allowN}, blocked ${blockOk}/${blockN}, empty ${empty}, http-errors ${errors}`);
}
console.log(
  `RATELIMIT ${model}: ${Object.entries(headerNums)
    .map(([k, v]) => `${k.replace('x-ratelimit-', '')}=${v}`)
    .join(' ')}`,
);
