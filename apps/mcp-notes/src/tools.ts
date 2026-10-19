import { defineTool as sharedDefineTool, ok, registerTools, toolError, type SdkMcpServer, type ToolDefinition as SharedToolDefinition } from '@urumi/shared';
import { z } from 'zod';
import { NotesFullError, type NotesStore } from './notesStore.js';

export interface NotesDeps {
  store: NotesStore;
  now: () => Date;
}

type ToolDefinition<S extends z.ZodObject = z.ZodObject> = SharedToolDefinition<NotesDeps, S>;

function defineTool<S extends z.ZodObject>(def: ToolDefinition<S>): ToolDefinition {
  return sharedDefineTool<NotesDeps, S>(def);
}

const MAX_ID = 2147483647;

const createNote = defineTool({
  name: 'create_note',
  title: 'Create note',
  description: 'Save a note with a title and text. Returns the new note.',
  inputSchema: z.object({ title: z.string().min(1).max(200), content: z.string().min(1).max(2000) }),
  handler: ({ title, content }, { store }) => {
    try {
      const note = store.create(title, content);
      return Promise.resolve(ok(`Saved note ${note.id}`, { note }));
    } catch (err) {
      // The store's own message, so the text always shows the configured limit.
      if (err instanceof NotesFullError) return Promise.resolve(toolError(err.message));
      throw err;
    }
  },
});

const listNotes = defineTool({
  name: 'list_notes',
  title: 'List notes',
  description: 'List saved notes, newest first.',
  inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(20) }),
  handler: ({ limit }, { store }) => {
    const notes = store.list(limit);
    return Promise.resolve(ok(`${notes.length} note(s)`, { notes, count: notes.length }));
  },
});

const searchNotes = defineTool({
  name: 'search_notes',
  title: 'Search notes',
  description: 'Find notes whose title or text contains the query (case-insensitive).',
  inputSchema: z.object({ query: z.string().min(1).max(100), limit: z.number().int().min(1).max(50).default(20) }),
  handler: ({ query, limit }, { store }) => {
    const notes = store.search(query, limit);
    return Promise.resolve(ok(`${notes.length} note(s) found`, { notes, count: notes.length }));
  },
});

const deleteNote = defineTool({
  name: 'delete_note',
  title: 'Delete note',
  description: 'Delete a note by id.',
  inputSchema: z.object({ id: z.number().int().min(1).max(MAX_ID) }),
  handler: ({ id }, { store }) => {
    if (!store.delete(id)) return Promise.resolve(toolError(`Note ${id} not found.`));
    return Promise.resolve(ok(`Deleted note ${id}`, { deleted: true, id }));
  },
});

const ping = defineTool({
  name: 'ping',
  title: 'Ping',
  description: 'Health check: returns ok and the server time.',
  inputSchema: z.object({}),
  handler: (_args, { now }) => {
    const time = now().toISOString();
    return Promise.resolve(ok(`ok at ${time}`, { ok: true, server: 'mcp-notes', time }));
  },
});

export const notesTools: readonly ToolDefinition[] = [createNote, listNotes, searchNotes, deleteNote, ping];

export function registerNotesTools(server: SdkMcpServer, deps: NotesDeps): void {
  registerTools(server, notesTools, deps);
}
