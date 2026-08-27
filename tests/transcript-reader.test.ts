import { beforeEach, describe, expect, it } from "vitest";
import { readStableTranscriptChunk, readTranscriptChunk } from "../src/content/transcript-reader";

function addSegment(timestamp: string, text: string): HTMLElement {
  const segment = document.createElement("ytd-transcript-segment-renderer");
  const timestampElement = document.createElement("span");
  const textElement = document.createElement("span");
  timestampElement.className = "segment-timestamp";
  timestampElement.textContent = timestamp;
  textElement.className = "segment-text";
  textElement.textContent = text;
  segment.append(timestampElement, textElement);
  document.body.append(segment);
  return segment;
}

describe("transcript chunk reader", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("splits an opened transcript on segment boundaries", () => {
    addSegment("00:00", "A".repeat(900));
    addSegment("00:30", "B".repeat(900));
    addSegment("01:00", "C".repeat(900));

    const first = readTranscriptChunk(document, 0, 2_000);
    const second = readTranscriptChunk(document, first.available ? first.nextCursor : 0, 2_000);

    expect(first).toMatchObject({
      available: true,
      cursor: 0,
      nextCursor: 2,
      done: false,
      startTime: "00:00",
      endTime: "00:30",
      segmentCount: 2,
      totalSegments: 3,
      contextText: "",
    });
    expect(first.available && first.text).toContain("[00:00]");
    expect(first.available && first.text).not.toContain("C".repeat(50));
    expect(second).toMatchObject({
      available: true,
      cursor: 2,
      nextCursor: 3,
      done: true,
      startTime: "01:00",
      endTime: "01:00",
      segmentCount: 1,
    });
    expect(second.available && second.contextText).toContain("[00:30]");
    expect(second.available && second.text).toContain("[01:00]");
  });

  it("supports explicit transcript data attributes on non-YouTube pages", () => {
    const segment = document.createElement("div");
    segment.dataset.transcriptSegment = "true";
    const timestamp = document.createElement("span");
    timestamp.dataset.transcriptTimestamp = "true";
    timestamp.textContent = "1:02:03";
    const text = document.createElement("span");
    text.dataset.transcriptText = "true";
    text.textContent = "  Important   conclusion  ";
    segment.append(timestamp, text);
    document.body.append(segment);

    expect(readTranscriptChunk(document, 0, 2_000)).toMatchObject({
      available: true,
      text: "[1:02:03] Important conclusion",
      startTime: "1:02:03",
      endTime: "1:02:03",
      done: true,
    });
  });

  it("reads YouTube's modern transcript segment view model without playing the video", () => {
    const segment = document.createElement("transcript-segment-view-model");
    segment.className = "ytwTranscriptSegmentViewModelHost";
    const timestamp = document.createElement("div");
    timestamp.className = "ytwTranscriptSegmentViewModelTimestamp";
    timestamp.textContent = "12:34";
    const accessibleTimestamp = document.createElement("div");
    accessibleTimestamp.className = "ytwTranscriptSegmentViewModelTimestampA11yLabel";
    accessibleTimestamp.textContent = "12분 34초";
    const text = document.createElement("span");
    text.className = "ytAttributedStringHost ytAttributedStringLinkInheritColor";
    text.textContent = "영상 재생과 무관하게 읽어야 하는 자막";
    segment.append(timestamp, accessibleTimestamp, text);
    document.body.append(segment);

    expect(readTranscriptChunk(document, 0, 2_000)).toMatchObject({
      available: true,
      text: "[12:34] 영상 재생과 무관하게 읽어야 하는 자막",
      startTime: "12:34",
      endTime: "12:34",
      done: true,
    });
  });

  it("ignores hidden and adjacent duplicate transcript segments", () => {
    addSegment("00:00", "Visible introduction");
    addSegment("00:00", "Visible introduction");
    const hidden = addSegment("00:10", "Hidden instructions");
    hidden.hidden = true;

    const result = readTranscriptChunk(document, 0, 2_000);

    expect(result).toMatchObject({ available: true, totalSegments: 1, segmentCount: 1 });
    expect(result.available && result.text).toBe("[00:00] Visible introduction");
  });

  it("continues from a stable segment key after an earlier insertion", () => {
    addSegment("00:00", "A".repeat(900));
    const secondElement = addSegment("00:30", "B".repeat(900));
    addSegment("01:00", "C".repeat(900));
    const first = readTranscriptChunk(document, 0, 2_000);
    expect(first).toMatchObject({ available: true, nextCursor: 2, endTime: "00:30" });
    if (!first.available) throw new Error("Expected the first transcript chunk.");

    const inserted = addSegment("00:15", "Late earlier segment");
    document.body.insertBefore(inserted, secondElement);
    const second = readTranscriptChunk(document, first.nextCursor, 2_000, first.lastSegmentKey);

    expect(second).toMatchObject({ available: true, startTime: "01:00" });
    expect(second.available && second.text).not.toContain("[00:30]");
  });

  it("removes non-adjacent duplicate transcript segments", () => {
    addSegment("00:00", "Repeated");
    addSegment("00:10", "Middle");
    addSegment("00:00", "Repeated");

    expect(readTranscriptChunk(document, 0, 2_000)).toMatchObject({
      available: true,
      totalSegments: 2,
      segmentCount: 2,
    });
  });

  it("keeps a final chunk open when a late segment appears during settlement", async () => {
    addSegment("00:00", "Opening");

    const first = await readStableTranscriptChunk(document, 0, 2_000, "", () => {
      addSegment("00:10", "Late segment");
      return Promise.resolve(true);
    });

    expect(first).toMatchObject({ available: true, done: false, totalSegments: 2 });
    if (!first.available) throw new Error("Expected a stable transcript chunk.");
    expect(
      readTranscriptChunk(document, first.nextCursor, 2_000, first.lastSegmentKey),
    ).toMatchObject({ available: true, startTime: "00:10", done: true });
  });

  it("does not confirm transcript completion when the quiet check times out", async () => {
    addSegment("00:00", "Still changing");

    const result = await readStableTranscriptChunk(document, 0, 2_000, "", () =>
      Promise.resolve(false),
    );

    expect(result).toMatchObject({ available: true, done: false, totalSegments: 1 });
  });

  it("reports an unavailable transcript without reading arbitrary page text", () => {
    document.body.textContent = "A long article that is not a transcript";

    expect(readTranscriptChunk(document, 0, 8_000)).toEqual({
      available: false,
      reason: "No opened transcript segments were found.",
    });
  });
});
