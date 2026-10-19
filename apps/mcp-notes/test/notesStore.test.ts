import { describe, expect, it } from 'vitest';
import { NotesFullError, NotesStore } from '../src/notesStore.js';

describe('NotesStore', () => {
  it('assigns ids 1, 2, 3 and ISO timestamps', () => {
    const s = new NotesStore({ now: () => new Date('2026-10-19T10:00:00Z') });
    expect(s.create('a', 'x').id).toBe(1);
    expect(s.create('b', 'y').id).toBe(2);
    const n = s.create('c', 'z');
    expect(n.id).toBe(3);
    expect(n.createdAt).toBe('2026-10-19T10:00:00.000Z');
  });
  it('lists newest first and respects limit', () => {
    const s = new NotesStore();
    s.create('a', 'x'); s.create('b', 'y'); s.create('c', 'z');
    expect(s.list(10).map((n) => n.id)).toEqual([3, 2, 1]);
    expect(s.list(2).map((n) => n.id)).toEqual([3, 2]);
  });
  it('searches title or content case-insensitively, newest first', () => {
    const s = new NotesStore();
    s.create('Daily orders', 'check');
    s.create('Other', 'review the orders list');
    s.create('Unrelated', 'nothing');
    expect(s.search('ORDERS', 10).map((n) => n.id)).toEqual([2, 1]);
    expect(s.search('ORDERS', 1)).toHaveLength(1);
  });
  it('deletes once', () => {
    const s = new NotesStore();
    const n = s.create('a', 'x');
    expect(s.delete(n.id)).toBe(true);
    expect(s.delete(n.id)).toBe(false);
  });
  it('throws NotesFullError past maxNotes', () => {
    const s = new NotesStore({ maxNotes: 2 });
    s.create('a', 'x'); s.create('b', 'y');
    expect(() => s.create('c', 'z')).toThrow(NotesFullError);
  });
});
