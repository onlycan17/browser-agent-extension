import { describe, expect, it } from "vitest";
import {
  createStorageMemoryRepository,
  StorageAgentMemoryService,
  originOf,
  type MemoryNote,
} from "../src/background/agent-memory-service";

function note(text: string, savedAt = 1_000, kind: MemoryNote["kind"] = "success"): MemoryNote {
  return { text, kind, savedAt };
}

function fakeStorage(initial: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    get: (keys: string[]) =>
      Promise.resolve(
        Object.fromEntries(keys.filter((key) => data.has(key)).map((key) => [key, data.get(key)])),
      ),
    set: (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) data.set(key, value);
      return Promise.resolve();
    },
    data,
  };
}

describe("StorageAgentMemoryService", () => {
  it("loads validated notes for an origin and drops malformed entries", async () => {
    const storage = fakeStorage({
      "agentMemory:https://example.com": [
        { text: "The search bar is under the account menu.", kind: "success", savedAt: 500 },
        { text: "Broken note", kind: "success" },
        { text: "Wrong kind", kind: "other", savedAt: 500 },
      ],
    });
    const service = new StorageAgentMemoryService(
      createStorageMemoryRepository(storage),
      () => 1_000,
    );

    await expect(service.load("https://example.com")).resolves.toEqual([
      { text: "The search bar is under the account menu.", kind: "success", savedAt: 500 },
    ]);
  });

  it("drops notes older than the retention window", async () => {
    const storage = fakeStorage({
      "agentMemory:https://example.com": [
        { text: "Very old lesson", kind: "success", savedAt: 0 },
        { text: "Fresh lesson", kind: "preference", savedAt: 9_900_000_000 },
      ],
    });
    const service = new StorageAgentMemoryService(
      createStorageMemoryRepository(storage),
      () => 10_000_000_000,
    );

    await expect(service.load("https://example.com")).resolves.toEqual([
      { text: "Fresh lesson", kind: "preference", savedAt: 9_900_000_000 },
    ]);
  });

  it("appends notes and keeps the newest bounded set", async () => {
    const storage = fakeStorage();
    const service = new StorageAgentMemoryService(
      createStorageMemoryRepository(storage),
      () => 1_000,
    );
    for (let index = 0; index < 10; index += 1) {
      await service.append("https://example.com", note(`Lesson ${String(index)}`, index));
    }

    const notes = await service.load("https://example.com");
    expect(notes).toHaveLength(8);
    expect(notes[0]?.text).toBe("Lesson 2");
    expect(notes.at(-1)?.text).toBe("Lesson 9");
  });

  it("returns an empty list when nothing was stored", async () => {
    const service = new StorageAgentMemoryService(createStorageMemoryRepository(fakeStorage()));

    await expect(service.load("https://example.com")).resolves.toEqual([]);
  });

  it("derives a stable origin from a page URL", () => {
    expect(originOf("https://example.com/some/path?query=1")).toBe("https://example.com");
    expect(originOf("not-a-url")).toBeNull();
  });
});
