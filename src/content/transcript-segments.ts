import type { TranscriptSegment } from "./transcript-reader";

export interface HttpSegment {
  offsetSeconds: number;
  durationSeconds: number;
  text: string;
}

export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const secs = total % 60;
  const minuteSecond = `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return hours > 0 ? `${String(hours).padStart(2, "0")}:${minuteSecond}` : minuteSecond;
}

export function toTranscriptSegments(http: readonly HttpSegment[]): TranscriptSegment[] {
  return http.map((segment) => {
    const timestamp = formatTimestamp(segment.offsetSeconds);
    return { timestamp, text: segment.text, key: `${timestamp}|${segment.text}` };
  });
}

const segmentCache = new Map<string, TranscriptSegment[]>();

export async function cachedSegments(
  key: string,
  loader: () => Promise<TranscriptSegment[]>,
): Promise<TranscriptSegment[]> {
  const cached = segmentCache.get(key);
  if (cached !== undefined) return cached;
  const segments = await loader();
  segmentCache.set(key, segments);
  return segments;
}
