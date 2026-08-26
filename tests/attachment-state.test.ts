import { describe, expect, it } from "vitest";
import type { RequestAttachment } from "../src/shared/attachments";
import { AttachmentState, AttachmentStateError } from "../src/sidepanel/attachment-state";

function text(name: string): RequestAttachment {
  return {
    kind: "text",
    name,
    mediaType: "text/plain",
    text: "content",
    size: 7,
    truncated: false,
  };
}

describe("AttachmentState", () => {
  it("adds, removes, snapshots, and clears request-scoped attachments", () => {
    const state = new AttachmentState();
    state.add([text("one.txt"), text("two.txt")]);

    const snapshot = state.snapshot();
    state.remove(0);

    expect(snapshot.map((item) => item.name)).toEqual(["one.txt", "two.txt"]);
    expect(state.snapshot().map((item) => item.name)).toEqual(["two.txt"]);
    state.clear();
    expect(state.snapshot()).toEqual([]);
  });

  it("rejects additions that exceed the shared request contract", () => {
    const state = new AttachmentState();

    expect(() => {
      state.add(Array.from({ length: 6 }, (_, index) => text(`${String(index)}.txt`)));
    }).toThrow(AttachmentStateError);
  });
});
