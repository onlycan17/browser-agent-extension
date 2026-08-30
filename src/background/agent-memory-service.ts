export interface MemoryNote {
  text: string;
  kind: "success" | "preference";
  savedAt: number;
}

export interface MemoryRepository {
  read(origin: string): Promise<unknown>;
  write(origin: string, value: MemoryNote[]): Promise<void>;
}

export interface AgentMemoryService {
  load(origin: string): Promise<readonly MemoryNote[]>;
  append(origin: string, note: MemoryNote): Promise<void>;
}

const STORAGE_PREFIX = "agentMemory:";
const MAX_NOTES_PER_ORIGIN = 8;
const MAX_NOTE_AGE_MS = 90 * 24 * 60 * 60 * 1000;

function isMemoryNote(value: unknown): value is MemoryNote {
  if (typeof value !== "object" || value === null) return false;
  const note = value as { text?: unknown; kind?: unknown; savedAt?: unknown };
  if (typeof note.text !== "string" || note.text.length === 0 || note.text.length > 300) {
    return false;
  }
  if (note.kind !== "success" && note.kind !== "preference") return false;
  return typeof note.savedAt === "number";
}

export class StorageAgentMemoryService implements AgentMemoryService {
  constructor(
    private readonly repository: MemoryRepository,
    private readonly now: () => number = Date.now,
  ) {}

  async load(origin: string): Promise<readonly MemoryNote[]> {
    const stored = await this.repository.read(origin);
    const candidates: unknown[] = Array.isArray(stored) ? stored : [];
    const cutoff = this.now() - MAX_NOTE_AGE_MS;
    return candidates
      .filter((note): note is MemoryNote => isMemoryNote(note) && note.savedAt >= cutoff)
      .slice(-MAX_NOTES_PER_ORIGIN);
  }

  async append(origin: string, note: MemoryNote): Promise<void> {
    const stored = await this.repository.read(origin);
    const storedNotes: unknown[] = Array.isArray(stored) ? stored : [];
    const notes = storedNotes.filter(isMemoryNote);
    notes.push(note);
    await this.repository.write(origin, notes.slice(-MAX_NOTES_PER_ORIGIN));
  }
}

export function createStorageMemoryRepository(storage: {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}): MemoryRepository {
  return {
    read: async (origin) => {
      const key = `${STORAGE_PREFIX}${origin}`;
      const result = await storage.get([key]);
      return result[key];
    },
    write: async (origin, value) => {
      await storage.set({ [`${STORAGE_PREFIX}${origin}`]: value });
    },
  };
}

export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
