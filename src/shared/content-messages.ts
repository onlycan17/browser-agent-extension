import { ALLOWED_KEYS, type PageActionRequest, type PageActionResult } from "./actions";
import {
  parseObservedElement,
  parsePageSnapshot,
  type ObservedElement,
  type PageSnapshot,
} from "./page";

export type ContentRequest =
  | { id: string; type: "CONTENT_PING"; payload: Record<string, never> }
  | { id: string; type: "PAGE_OBSERVE"; payload: Record<string, never> }
  | ({ id: string } & PageActionRequest);

export type ContentResponse<T> =
  | { id: string; ok: true; data: T }
  | { id: string; ok: false; error: { code: string; message: string; retryable: boolean } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasOnlyKeys(record: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(record).every((key) => keys.includes(key));
}

function parseTarget(value: unknown): { generation: number; elementId: string } | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["generation", "elementId"])) return null;
  if (!Number.isInteger(value.generation) || Number(value.generation) < 1) return null;
  if (typeof value.elementId !== "string" || value.elementId.length > 80) return null;
  return { generation: Number(value.generation), elementId: value.elementId };
}

function parseGuardedTarget(
  value: unknown,
): { generation: number; elementId: string; expected: ObservedElement } | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["generation", "elementId", "expected"])) return null;
  if (
    !isRecord(value.expected) ||
    !hasOnlyKeys(value.expected, [
      "id",
      "tag",
      "role",
      "name",
      "disabled",
      "bounds",
      "inputType",
      "autocomplete",
      "href",
      "download",
    ])
  ) {
    return null;
  }
  const target = parseTarget({ generation: value.generation, elementId: value.elementId });
  const expected = parseObservedElement(value.expected);
  if (target === null || expected?.id !== target.elementId) return null;
  return { ...target, expected };
}

function parseTypeText(value: unknown): PageActionRequest["payload"] | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["generation", "elementId", "text", "replace", "expected"])
  )
    return null;
  const target = parseGuardedTarget({
    generation: value.generation,
    elementId: value.elementId,
    expected: value.expected,
  });
  if (target === null || typeof value.text !== "string" || value.text.length > 4000) return null;
  if (typeof value.replace !== "boolean") return null;
  return { ...target, text: value.text, replace: value.replace };
}

function parseYouTubeControl(payload: unknown): PageActionRequest | null {
  if (!isRecord(payload) || typeof payload.action !== "string") return null;
  if (payload.action === "play" || payload.action === "pause") {
    return hasOnlyKeys(payload, ["action"])
      ? { type: "YOUTUBE_CONTROL", payload: { action: payload.action } }
      : null;
  }
  const actions = ["seek", "set_volume", "set_rate"] as const;
  const action = actions.find((item) => item === payload.action);
  if (action === undefined || !hasOnlyKeys(payload, ["action", "value"])) return null;
  return typeof payload.value === "number" && Number.isFinite(payload.value)
    ? { type: "YOUTUBE_CONTROL", payload: { action, value: payload.value } }
    : null;
}

function parseAction(type: unknown, payload: unknown): PageActionRequest | null {
  if (type === "PAGE_CLICK") {
    const target = parseGuardedTarget(payload);
    return target === null ? null : { type, payload: target };
  }
  if (type === "PAGE_TYPE_TEXT") {
    const parsed = parseTypeText(payload);
    if (parsed === null || !("text" in parsed)) return null;
    return { type, payload: parsed };
  }
  if (type === "PAGE_PRESS_KEY" && isRecord(payload) && hasOnlyKeys(payload, ["key"])) {
    const key = ALLOWED_KEYS.find((item) => item === payload.key);
    return key === undefined ? null : { type, payload: { key } };
  }
  if (type === "YOUTUBE_CONTROL") return parseYouTubeControl(payload);
  if (type !== "PAGE_SCROLL" || !isRecord(payload)) return null;
  if (!hasOnlyKeys(payload, ["direction", "amount"])) return null;
  const directions = ["up", "down", "left", "right"] as const;
  const direction = directions.find((item) => item === payload.direction);
  if (direction === undefined || !Number.isInteger(payload.amount)) return null;
  const amount = Number(payload.amount);
  return amount < 1 || amount > 2000 ? null : { type, payload: { direction, amount } };
}

function parseBase(value: unknown): { id: string; type: unknown; payload: unknown } | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "type", "payload"])) return null;
  if (typeof value.id !== "string" || value.id.length === 0 || value.id.length > 128) return null;
  return { id: value.id, type: value.type, payload: value.payload };
}

export function parseContentRequest(value: unknown): ContentRequest | null {
  const base = parseBase(value);
  if (base === null) return null;
  if (base.type === "CONTENT_PING" || base.type === "PAGE_OBSERVE") {
    if (!isRecord(base.payload) || Object.keys(base.payload).length > 0) return null;
    return { id: base.id, type: base.type, payload: {} };
  }
  const action = parseAction(base.type, base.payload);
  return action === null ? null : { id: base.id, ...action };
}

export function parsePingResponse(value: unknown, id: string): boolean {
  if (!isRecord(value) || value.id !== id || value.ok !== true) return false;
  if (!isRecord(value.data)) return false;
  return value.data.ready === true;
}

export function parseObserveResponse(value: unknown, id: string): PageSnapshot | null {
  if (!isRecord(value) || value.id !== id || value.ok !== true) return null;
  return parsePageSnapshot(value.data);
}

export function parseActionResponse(value: unknown, id: string): PageActionResult | null {
  if (!isRecord(value) || value.id !== id || value.ok !== true) return null;
  if (!isRecord(value.data) || typeof value.data.message !== "string") return null;
  return { message: value.data.message };
}
