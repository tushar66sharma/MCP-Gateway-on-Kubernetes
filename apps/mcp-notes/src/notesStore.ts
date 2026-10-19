export interface Note {
  id: number;
  title: string;
  content: string;
  createdAt: string;
}

export class NotesFullError extends Error {
  constructor(max: number) {
    super(`Note limit reached (${max}); delete some notes first.`);
    this.name = 'NotesFullError';
  }
}

/** In-memory store: a restart clears every note. */
export class NotesStore {
  private readonly notes: Note[] = []; // oldest first
  private nextId = 1;
  private readonly maxNotes: number;
  private readonly now: () => Date;

  constructor(o: { maxNotes?: number; now?: () => Date } = {}) {
    this.maxNotes = o.maxNotes ?? 500;
    this.now = o.now ?? (() => new Date());
  }

  create(title: string, content: string): Note {
    if (this.notes.length >= this.maxNotes) throw new NotesFullError(this.maxNotes);
    const note: Note = { id: this.nextId++, title, content, createdAt: this.now().toISOString() };
    this.notes.push(note);
    return note;
  }

  list(limit: number): Note[] {
    return this.notes.slice().reverse().slice(0, limit);
  }

  search(query: string, limit: number): Note[] {
    const q = query.toLowerCase();
    return this.notes
      .filter((n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q))
      .reverse()
      .slice(0, limit);
  }

  delete(id: number): boolean {
    const i = this.notes.findIndex((n) => n.id === id);
    if (i < 0) return false;
    this.notes.splice(i, 1);
    return true;
  }
}
