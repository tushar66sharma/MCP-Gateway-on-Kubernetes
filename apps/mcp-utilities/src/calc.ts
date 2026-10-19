export class CalcError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'CalcError';
  }
}

const MAX_DEPTH = 50;

/**
 * Recursive-descent arithmetic evaluator (no eval/Function/vm).
 *   expr   := term (('+'|'-') term)*
 *   term   := unary (('*'|'/'|'%') unary)*
 *   unary  := '-' unary | power
 *   power  := atom ('^' unary)?
 *   atom   := number | '(' expr ')'
 */
export function evaluate(expr: string): number {
  let pos = 0;
  let depth = 0;

  const skip = (): void => {
    while (pos < expr.length && /\s/.test(expr.charAt(pos))) pos++;
  };
  const peek = (): string | undefined => {
    skip();
    return pos < expr.length ? expr.charAt(pos) : undefined;
  };
  const fail = (): never => {
    const c = peek();
    if (c === undefined) throw new CalcError('unexpected end of expression');
    throw new CalcError(`unexpected character '${c}' at position ${pos}`);
  };
  const nest = <T>(fn: () => T): T => {
    if (++depth > MAX_DEPTH) throw new CalcError('too deeply nested');
    try {
      return fn();
    } finally {
      depth--;
    }
  };
  const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';

  const parseExpr = (): number => {
    let v = parseTerm();
    for (let c = peek(); c === '+' || c === '-'; c = peek()) {
      pos++;
      const r = parseTerm();
      v = c === '+' ? v + r : v - r;
    }
    return v;
  };
  const parseTerm = (): number => {
    let v = parseUnary();
    for (let c = peek(); c === '*' || c === '/' || c === '%'; c = peek()) {
      pos++;
      const r = parseUnary();
      if (c === '*') {
        v *= r;
      } else {
        if (r === 0) throw new CalcError('division by zero');
        v = c === '/' ? v / r : v % r;
      }
    }
    return v;
  };
  const parseUnary = (): number => {
    if (peek() === '-') {
      pos++;
      return nest(() => -parseUnary());
    }
    return parsePower();
  };
  const parsePower = (): number => {
    const base = parseAtom();
    if (peek() === '^') {
      pos++;
      return base ** nest(parseUnary);
    }
    return base;
  };
  const parseAtom = (): number => {
    const c = peek();
    if (c === '(') {
      pos++;
      const v = nest(parseExpr);
      if (peek() !== ')') fail();
      pos++;
      return v;
    }
    if (isDigit(c)) {
      const start = pos;
      while (isDigit(expr.charAt(pos))) pos++;
      if (expr.charAt(pos) === '.') {
        pos++;
        if (!isDigit(expr.charAt(pos))) {
          if (pos >= expr.length) throw new CalcError('unexpected end of expression');
          throw new CalcError(`unexpected character '${expr.charAt(pos)}' at position ${pos}`);
        }
        while (isDigit(expr.charAt(pos))) pos++;
      }
      return Number(expr.slice(start, pos));
    }
    return fail();
  };

  const result = parseExpr();
  if (peek() !== undefined) fail();
  if (!Number.isFinite(result)) throw new CalcError('result is not a finite number');
  return Number(result.toPrecision(12));
}
