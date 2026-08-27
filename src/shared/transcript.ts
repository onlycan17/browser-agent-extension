export const TRANSCRIPT_CHUNK_MIN_CHARS = 2_000;
export const TRANSCRIPT_CHUNK_MAX_CHARS = 8_000;
export const TRANSCRIPT_CONTEXT_MAX_CHARS = 2_000;
const MAX_TRANSCRIPT_SEGMENTS = 100_000;
const MAX_TIMESTAMP_CHARS = 32;
const MAX_UNAVAILABLE_REASON_CHARS = 200;

export interface TranscriptChunkRequest {
  cursor: number;
  maxChars: number;
}

export type TranscriptChunkResult =
  | { available: false; reason: string }
  | {
      available: true;
      cursor: number;
      nextCursor: number;
      done: boolean;
      startTime: string;
      endTime: string;
      contextText: string;
      text: string;
      segmentCount: number;
      totalSegments: number;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasOnlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(record).every((key) => keys.includes(key));
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number | null {
  if (!Number.isInteger(value)) return null;
  const parsed = Number(value);
  return parsed >= minimum && parsed <= maximum ? parsed : null;
}

export function parseTranscriptChunkRequest(value: unknown): TranscriptChunkRequest | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["cursor", "maxChars"])) return null;
  const cursor = boundedInteger(value.cursor, 0, MAX_TRANSCRIPT_SEGMENTS - 1);
  const maxChars = boundedInteger(
    value.maxChars,
    TRANSCRIPT_CHUNK_MIN_CHARS,
    TRANSCRIPT_CHUNK_MAX_CHARS,
  );
  return cursor === null || maxChars === null ? null : { cursor, maxChars };
}

function parseUnavailableChunk(value: Record<string, unknown>): TranscriptChunkResult | null {
  if (!hasOnlyKeys(value, ["available", "reason"]) || typeof value.reason !== "string") {
    return null;
  }
  const reason = value.reason.trim();
  return reason.length === 0 || reason.length > MAX_UNAVAILABLE_REASON_CHARS
    ? null
    : { available: false, reason };
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_TIMESTAMP_CHARS;
}

function parseAvailableChunk(value: Record<string, unknown>): TranscriptChunkResult | null {
  const keys = [
    "available",
    "cursor",
    "nextCursor",
    "done",
    "startTime",
    "endTime",
    "contextText",
    "text",
    "segmentCount",
    "totalSegments",
  ];
  if (!hasOnlyKeys(value, keys) || typeof value.done !== "boolean") return null;
  if (!validTimestamp(value.startTime) || !validTimestamp(value.endTime)) return null;
  if (typeof value.contextText !== "string" || typeof value.text !== "string") return null;
  if (
    value.contextText.length > TRANSCRIPT_CONTEXT_MAX_CHARS ||
    value.text.length === 0 ||
    value.text.length > TRANSCRIPT_CHUNK_MAX_CHARS
  ) {
    return null;
  }
  const cursor = boundedInteger(value.cursor, 0, MAX_TRANSCRIPT_SEGMENTS - 1);
  const nextCursor = boundedInteger(value.nextCursor, 1, MAX_TRANSCRIPT_SEGMENTS);
  const segmentCount = boundedInteger(value.segmentCount, 1, MAX_TRANSCRIPT_SEGMENTS);
  const totalSegments = boundedInteger(value.totalSegments, 1, MAX_TRANSCRIPT_SEGMENTS);
  if (cursor === null || nextCursor === null || segmentCount === null || totalSegments === null) {
    return null;
  }
  if (
    nextCursor <= cursor ||
    nextCursor > totalSegments ||
    segmentCount !== nextCursor - cursor ||
    value.done !== (nextCursor === totalSegments)
  ) {
    return null;
  }
  return {
    available: true,
    cursor,
    nextCursor,
    done: value.done,
    startTime: value.startTime,
    endTime: value.endTime,
    contextText: value.contextText,
    text: value.text,
    segmentCount,
    totalSegments,
  };
}

export function parseTranscriptChunkResult(value: unknown): TranscriptChunkResult | null {
  if (!isRecord(value) || typeof value.available !== "boolean") return null;
  return value.available ? parseAvailableChunk(value) : parseUnavailableChunk(value);
}
