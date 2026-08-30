import type { TranscriptChunkResult } from "../shared/transcript";
import { chunkTranscriptSegments, type TranscriptSegment } from "./transcript-reader";
import { cachedSegments, toTranscriptSegments, type HttpSegment } from "./transcript-segments";

const VTT_TIMEOUT_MS = 10_000;
const MAX_DISCOVERY_URLS = 5;

export function parseVtt(text: string): HttpSegment[] {
  const segments: HttpSegment[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  const timePattern =
    /^(\d{2,}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2,}):(\d{2}):(\d{2})[.,](\d{3})/;
  let index = 0;
  while (index < lines.length) {
    const match = timePattern.exec(lines[index] ?? "");
    if (match === null) {
      index += 1;
      continue;
    }
    const start =
      Number(match[1]) * 3_600 +
      Number(match[2]) * 60 +
      Number(match[3]) +
      Number(match[4]) / 1_000;
    const end =
      Number(match[5]) * 3_600 +
      Number(match[6]) * 60 +
      Number(match[7]) +
      Number(match[8]) / 1_000;
    index += 1;
    const payload: string[] = [];
    while (index < lines.length && (lines[index] ?? "").trim().length > 0) {
      payload.push(lines[index] ?? "");
      index += 1;
    }
    const content = decodeVttText(payload.join("\n"));
    if (content.length > 0) {
      segments.push({
        offsetSeconds: start,
        durationSeconds: Math.max(0, end - start),
        text: content,
      });
    }
  }
  return segments;
}

function decodeVttText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(source: string, location: Location): string | null {
  try {
    const url = new URL(source, location.href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function isTranscriptResourceName(name: string): boolean {
  return (
    /^https?:/.test(name) &&
    (/\.vtt(\?|#|$)/i.test(name) || /timedtext|\/captions|subtitle/i.test(name))
  );
}

export function discoverVttUrls(document: Document, location: Location): string[] {
  const urls: string[] = [];
  for (const track of document.querySelectorAll(
    "track[kind='captions'], track[kind='subtitles']",
  )) {
    const src = track.getAttribute("src");
    if (src === null) continue;
    const absolute = absoluteUrl(src, location);
    if (absolute !== null) urls.push(absolute);
  }
  if (typeof performance.getEntriesByType === "function") {
    for (const entry of performance.getEntriesByType("resource")) {
      if (isTranscriptResourceName(entry.name)) urls.push(entry.name);
    }
  }
  return [...new Set(urls)];
}

function preferredLocale(localeId: string): boolean {
  const language = (navigator.language || "en").split("-")[0] ?? "en";
  return localeId.toLowerCase().startsWith(language) || localeId.toLowerCase().startsWith("en");
}

async function udemyCaptionUrls(location: Location): Promise<string[]> {
  if (!location.hostname.endsWith("udemy.com")) return [];
  const lectureId = /\/learn\/lecture\/(\d+)/.exec(location.href)?.[1];
  if (lectureId === undefined) return [];
  const apiPattern = new RegExp(`\\S*lectures/${lectureId}/\\?\\S*fields\\[asset\\]=\\S*captions`);
  const apiUrl =
    typeof performance.getEntriesByType === "function"
      ? performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .find((name) => apiPattern.test(name))
      : undefined;
  if (apiUrl === undefined) return [];
  const response = await fetch(apiUrl, { signal: AbortSignal.timeout(VTT_TIMEOUT_MS) });
  if (!response.ok) return [];
  const data: unknown = await response.json();
  const captions = (data as { asset?: { captions?: { url?: unknown; locale_id?: unknown }[] } })
    ?.asset?.captions;
  if (!Array.isArray(captions)) return [];
  const urls = captions
    .map((caption) => (typeof caption?.url === "string" ? caption.url : null))
    .filter((url): url is string => url !== null && /^https:\/\//.test(url));
  const preferred = urls.filter((_, index) => {
    const localeId = captions[index]?.locale_id;
    return typeof localeId === "string" && preferredLocale(localeId);
  });
  return [...new Set([...preferred, ...urls])].slice(0, 2);
}

async function segmentsFromVttUrl(url: string): Promise<TranscriptSegment[]> {
  return cachedSegments(`vtt:${url}`, async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(VTT_TIMEOUT_MS) });
    if (!response.ok)
      throw new Error(`The caption file request failed (${String(response.status)}).`);
    const parsed = parseVtt(await response.text());
    if (parsed.length === 0) throw new Error("The caption file has no readable cues.");
    return toTranscriptSegments(parsed);
  });
}

export async function readVttTranscriptChunk(
  document: Document,
  location: Location,
  cursor: number,
  maxChars: number,
  afterSegmentKey: string,
): Promise<TranscriptChunkResult> {
  const candidates = discoverVttUrls(document, location);
  for (const url of candidates.slice(0, MAX_DISCOVERY_URLS)) {
    try {
      const segments = await segmentsFromVttUrl(url);
      if (segments.length > 0) {
        return chunkTranscriptSegments(segments, cursor, maxChars, afterSegmentKey);
      }
    } catch {
      continue;
    }
  }
  try {
    const udemyUrls = await udemyCaptionUrls(location);
    for (const url of udemyUrls) {
      const segments = await segmentsFromVttUrl(url);
      if (segments.length > 0) {
        return chunkTranscriptSegments(segments, cursor, maxChars, afterSegmentKey);
      }
    }
  } catch {
    return { available: false, reason: "No downloadable VTT captions were found on this page." };
  }
  return { available: false, reason: "No downloadable VTT captions were found on this page." };
}
