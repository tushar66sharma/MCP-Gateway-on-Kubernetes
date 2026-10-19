import { describe, expect, it } from 'vitest';
import { CalcError, evaluate } from '../src/calc.js';

describe('evaluate', () => {
  it.each([
    ['2+3*4', 14], ['(2+3)*4', 20], ['2^3^2', 512], ['-2^2', -4], ['2^-1', 0.5],
    ['10%4', 2], ['7/2', 3.5], [' 1.5 * 2 ', 3], ['0.1+0.2', 0.3], ['--3', 3],
  ])('%s = %s', (expr, expected) => {
    expect(evaluate(expr)).toBe(expected);
  });
  it.each([
    ['1/0', 'division by zero'],
    ['5%0', 'division by zero'],
    ['process.exit()', "unexpected character 'p' at position 0"],
    ['2+', 'unexpected end of expression'],
    ['(1', 'unexpected end of expression'],
    ['10^400', 'result is not a finite number'],
    [`${'('.repeat(51)}1${')'.repeat(51)}`, 'too deeply nested'],
  ])('%s throws %s', (expr, msg) => {
    expect(() => evaluate(expr)).toThrow(CalcError);
    expect(() => evaluate(expr)).toThrow(msg);
  });
  it('allows depth 50', () => {
    expect(evaluate(`${'('.repeat(50)}1${')'.repeat(50)}`)).toBe(1);
  });
});
