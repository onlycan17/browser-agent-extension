export interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ObservedElement {
  id: string;
  tag: string;
  role: string;
  name: string;
  disabled: boolean;
  bounds: ElementBounds;
  inputType?: string;
  href?: string;
  download?: boolean;
}

export interface PageViewport {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
}

export interface YouTubeState {
  title: string;
  currentTime: number;
  duration: number;
  paused: boolean;
  playbackRate: number;
  volume: number;
  captionText?: string;
}

export interface PageSnapshot {
  generation: number;
  url: string;
  title: string;
  viewport: PageViewport;
  visibleText: string;
  elements: ObservedElement[];
  youtube?: YouTubeState;
}

export interface PageAnalysisResult {
  answer: string;
  url: string;
  title: string;
  screenshotUsed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseBounds(value: unknown): ElementBounds | null {
  if (!isRecord(value)) return null;
  const { x, y, width, height } = value;
  if (![x, y, width, height].every(isNumber)) return null;
  return { x: Number(x), y: Number(y), width: Number(width), height: Number(height) };
}

function parseElement(value: unknown): ObservedElement | null {
  if (!isRecord(value)) return null;
  const { id, tag, role, name, disabled } = value;
  const bounds = parseBounds(value.bounds);
  if (![id, tag, role, name].every((item) => typeof item === "string")) return null;
  if (typeof disabled !== "boolean" || bounds === null) return null;
  if (value.inputType !== undefined && typeof value.inputType !== "string") return null;
  if (value.href !== undefined && typeof value.href !== "string") return null;
  if (value.download !== undefined && typeof value.download !== "boolean") return null;
  const base = {
    id: String(id),
    tag: String(tag),
    role: String(role),
    name: String(name),
    disabled,
    bounds,
  };
  return {
    ...base,
    ...(typeof value.inputType === "string" ? { inputType: value.inputType } : {}),
    ...(typeof value.href === "string" ? { href: value.href } : {}),
    ...(typeof value.download === "boolean" ? { download: value.download } : {}),
  };
}

function parseYouTube(value: unknown): YouTubeState | null {
  if (!isRecord(value) || typeof value.title !== "string" || typeof value.paused !== "boolean")
    return null;
  const numbers = [value.currentTime, value.duration, value.playbackRate, value.volume];
  if (!numbers.every(isNumber)) return null;
  if (value.captionText !== undefined && typeof value.captionText !== "string") return null;
  return {
    title: value.title,
    currentTime: Number(value.currentTime),
    duration: Number(value.duration),
    paused: value.paused,
    playbackRate: Number(value.playbackRate),
    volume: Number(value.volume),
    ...(typeof value.captionText === "string" ? { captionText: value.captionText } : {}),
  };
}

function parseViewport(value: unknown): PageViewport | null {
  if (!isRecord(value)) return null;
  const { width, height, scrollX, scrollY } = value;
  if (![width, height, scrollX, scrollY].every(isNumber)) return null;
  return {
    width: Number(width),
    height: Number(height),
    scrollX: Number(scrollX),
    scrollY: Number(scrollY),
  };
}

export function parsePageSnapshot(value: unknown): PageSnapshot | null {
  if (!isRecord(value) || !Array.isArray(value.elements)) return null;
  const viewport = parseViewport(value.viewport);
  const elements = value.elements.map(parseElement);
  if (viewport === null || elements.some((element) => element === null)) return null;
  if (!Number.isInteger(value.generation) || Number(value.generation) < 1) return null;
  if (typeof value.url !== "string" || typeof value.title !== "string") return null;
  if (typeof value.visibleText !== "string" || value.visibleText.length > 12_000) return null;
  const youtube = value.youtube === undefined ? undefined : parseYouTube(value.youtube);
  if (youtube === null) return null;
  return {
    generation: Number(value.generation),
    url: value.url,
    title: value.title,
    viewport,
    visibleText: value.visibleText,
    elements: elements.filter((element) => element !== null),
    ...(youtube === undefined ? {} : { youtube }),
  };
}
