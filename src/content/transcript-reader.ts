import {
  TRANSCRIPT_CHUNK_MAX_CHARS,
  TRANSCRIPT_CHUNK_MIN_CHARS,
  TRANSCRIPT_CONTEXT_MAX_CHARS,
  type TranscriptChunkResult,
} from "../shared/transcript";

interface TranscriptSegment {
  timestamp: string;
  text: string;
  key: string;
}

const SEGMENT_SELECTOR = [
  "ytd-transcript-segment-renderer",
  "transcript-segment-view-model",
  "[data-transcript-segment]",
].join(",");
const TIMESTAMP_SELECTOR = [
  ".segment-timestamp",
  ".ytwTranscriptSegmentViewModelTimestamp",
  "[data-transcript-timestamp]",
].join(",");
const TEXT_SELECTOR = [".segment-text", ".ytAttributedStringHost", "[data-transcript-text]"].join(
  ",",
);
const MAX_SEGMENT_TEXT_CHARS = 1_800;
const CONTEXT_SEGMENTS = 2;

function compactText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function isRendered(element: HTMLElement): boolean {
  const view = element.ownerDocument.defaultView;
  for (
    let current: HTMLElement | null = element;
    current !== null;
    current = current.parentElement
  ) {
    const style = view?.getComputedStyle(current);
    if (
      current.hidden ||
      style?.display === "none" ||
      style?.visibility === "hidden" ||
      Number(style?.opacity ?? 1) === 0
    ) {
      return false;
    }
  }
  return true;
}

function validTimestamp(value: string): boolean {
  return /^(?:\d{1,3}:)?\d{1,2}:\d{2}$/.test(value);
}

function segmentKey(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function splitSegmentText(value: string): string[] {
  if (value.length <= MAX_SEGMENT_TEXT_CHARS) return [value];
  const parts: string[] = [];
  let remaining = value;
  while (remaining.length > MAX_SEGMENT_TEXT_CHARS) {
    const candidate = remaining.slice(0, MAX_SEGMENT_TEXT_CHARS + 1);
    const boundary = candidate.lastIndexOf(" ");
    const end = boundary > MAX_SEGMENT_TEXT_CHARS / 2 ? boundary : MAX_SEGMENT_TEXT_CHARS;
    parts.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining.length > 0) parts.push(remaining);
  return parts;
}

function transcriptSegments(document: Document): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const seen = new Set<string>();
  for (const candidate of document.querySelectorAll<HTMLElement>(SEGMENT_SELECTOR)) {
    if (!isRendered(candidate)) continue;
    const timestamp = compactText(candidate.querySelector(TIMESTAMP_SELECTOR)?.textContent);
    const text = compactText(candidate.querySelector(TEXT_SELECTOR)?.textContent);
    if (!validTimestamp(timestamp) || text.length === 0) continue;
    const signature = `${timestamp}\n${text}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    for (const [index, part] of splitSegmentText(text).entries()) {
      segments.push({ timestamp, text: part, key: segmentKey(`${signature}\n${String(index)}`) });
    }
  }
  return segments;
}

function line(segment: TranscriptSegment): string {
  return `[${segment.timestamp}] ${segment.text}`;
}

function contextText(segments: readonly TranscriptSegment[], cursor: number): string {
  const start = Math.max(0, cursor - CONTEXT_SEGMENTS);
  return segments.slice(start, cursor).map(line).join("\n").slice(-TRANSCRIPT_CONTEXT_MAX_CHARS);
}

function anchoredCursor(
  segments: readonly TranscriptSegment[],
  cursor: number,
  afterSegmentKey: string,
): number | null {
  if (afterSegmentKey.length === 0) return cursor;
  const anchor = segments.findIndex((segment) => segment.key === afterSegmentKey);
  return anchor < 0 ? null : anchor + 1;
}

export function readTranscriptChunk(
  document: Document,
  cursor: number,
  maxChars: number,
  afterSegmentKey = "",
): TranscriptChunkResult {
  const segments = transcriptSegments(document);
  if (segments.length === 0) {
    return { available: false, reason: "No opened transcript segments were found." };
  }
  const startCursor = anchoredCursor(segments, cursor, afterSegmentKey);
  if (
    startCursor === null ||
    !Number.isInteger(startCursor) ||
    startCursor < 0 ||
    startCursor >= segments.length
  ) {
    return { available: false, reason: "The transcript cursor is no longer available." };
  }
  const limit = Math.min(
    TRANSCRIPT_CHUNK_MAX_CHARS,
    Math.max(TRANSCRIPT_CHUNK_MIN_CHARS, Math.trunc(maxChars)),
  );
  const lines: string[] = [];
  let length = 0;
  let nextCursor = startCursor;
  while (nextCursor < segments.length) {
    const segment = segments[nextCursor];
    if (segment === undefined) break;
    const nextLine = line(segment);
    const separatorLength = lines.length === 0 ? 0 : 1;
    if (lines.length > 0 && length + separatorLength + nextLine.length > limit) break;
    lines.push(nextLine);
    length += separatorLength + nextLine.length;
    nextCursor += 1;
  }
  const first = segments[startCursor];
  const last = segments[nextCursor - 1];
  if (first === undefined || last === undefined) {
    return { available: false, reason: "The transcript chunk could not be created." };
  }
  return {
    available: true,
    cursor: startCursor,
    nextCursor,
    done: nextCursor === segments.length,
    startTime: first.timestamp,
    endTime: last.timestamp,
    contextText: contextText(segments, startCursor),
    text: lines.join("\n"),
    segmentCount: nextCursor - startCursor,
    totalSegments: segments.length,
    lastSegmentKey: last.key,
  };
}

export async function readStableTranscriptChunk(
  document: Document,
  cursor: number,
  maxChars: number,
  afterSegmentKey: string,
  settle: () => Promise<boolean>,
): Promise<TranscriptChunkResult> {
  const chunk = readTranscriptChunk(document, cursor, maxChars, afterSegmentKey);
  if (!chunk.available || !chunk.done) return chunk;
  const settled = await settle();
  if (!settled) return { ...chunk, done: false };
  const later = readTranscriptChunk(document, chunk.nextCursor, maxChars, chunk.lastSegmentKey);
  if (!later.available) return chunk;
  return {
    ...chunk,
    done: false,
    totalSegments: Math.max(chunk.totalSegments, later.totalSegments),
  };
}
