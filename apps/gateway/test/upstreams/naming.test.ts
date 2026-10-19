import { describe, expect, it } from 'vitest';
import { parseGatewayToolName, toGatewayToolName } from '../../src/upstreams/naming.js';

describe('toGatewayToolName', () => {
  it('prefixes the slug with the separator', () => {
    expect(toGatewayToolName('woo', 'list_orders')).toBe('woo__list_orders');
  });
  it('returns null when the result is longer than 64 characters', () => {
    expect(toGatewayToolName('woo', 'x'.repeat(70))).toBeNull();
  });
  it('returns null when the tool name has a character outside the allowed set', () => {
    expect(toGatewayToolName('a', 'x.y')).toBeNull();
    expect(toGatewayToolName('notes', 'has space')).toBeNull();
  });
});

describe('parseGatewayToolName', () => {
  it('splits slug and tool', () => {
    expect(parseGatewayToolName('notes__ping')).toEqual({ slug: 'notes', tool: 'ping' });
  });
  it('splits on the first separator', () => {
    expect(parseGatewayToolName('a__b__c')).toEqual({ slug: 'a', tool: 'b__c' });
  });
  it('returns null without a separator', () => {
    expect(parseGatewayToolName('noseparator')).toBeNull();
  });
  it('returns null for an empty slug', () => {
    expect(parseGatewayToolName('__x')).toBeNull();
  });
  it('returns null for an empty tool', () => {
    expect(parseGatewayToolName('notes__')).toBeNull();
  });
});
