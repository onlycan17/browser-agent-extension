import type { ElementBounds, ObservedElement, PageSnapshot } from "../shared/page";
import { ElementRegistry } from "./element-registry";
import { YouTubeAdapter } from "./youtube-adapter";

const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "[contenteditable='true']",
  "[role='button']",
  "[role='link']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='textbox']",
].join(",");
const MAX_ELEMENTS = 150;
const MAX_VISIBLE_TEXT = 12_000;
const MAX_FIELD_TEXT = 300;

function compactText(value: string | null | undefined, limit = MAX_FIELD_TEXT): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0)
    return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  return (
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth
  );
}

function labelText(element: HTMLElement): string {
  if (!(
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  )) {
    return "";
  }
  return compactText(
    Array.from(element.labels ?? [])
      .map((label) => label.textContent)
      .join(" "),
  );
}

function labelledByText(element: HTMLElement): string {
  const ids = element.getAttribute("aria-labelledby")?.split(/\s+/) ?? [];
  return compactText(ids.map((id) => document.getElementById(id)?.textContent).join(" "));
}

function accessibleName(element: HTMLElement): string {
  const candidates = [
    element.getAttribute("aria-label"),
    labelledByText(element),
    labelText(element),
  ];
  for (const candidate of candidates) {
    const name = compactText(candidate);
    if (name.length > 0) return name;
  }
  if (element instanceof HTMLInputElement) return compactText(element.placeholder || element.alt);
  return compactText(element.getAttribute("title") ?? element.textContent);
}

function elementRole(element: HTMLElement): string {
  const explicit = element.getAttribute("role");
  if (explicit !== null) return explicit;
  if (element instanceof HTMLAnchorElement) return "link";
  if (element instanceof HTMLButtonElement) return "button";
  if (element instanceof HTMLSelectElement) return "combobox";
  if (element instanceof HTMLTextAreaElement) return "textbox";
  if (element instanceof HTMLInputElement) return inputRole(element.type);
  return element.isContentEditable ? "textbox" : element.tagName.toLowerCase();
}

function inputRole(type: string): string {
  if (type === "checkbox" || type === "radio" || type === "range") return type;
  if (type === "button" || type === "submit" || type === "reset") return "button";
  return "textbox";
}

function safeLinkOrigin(element: HTMLElement): string | undefined {
  if (!(element instanceof HTMLAnchorElement)) return undefined;
  try {
    return new URL(element.href).origin;
  } catch {
    return undefined;
  }
}

function elementBounds(element: HTMLElement): ElementBounds {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function observeElement(element: HTMLElement, registry: ElementRegistry): ObservedElement {
  const inputType =
    element instanceof HTMLInputElement || element instanceof HTMLButtonElement
      ? element.type
      : undefined;
  const href = safeLinkOrigin(element);
  const download = element instanceof HTMLAnchorElement && element.hasAttribute("download");
  const base = {
    id: registry.register(element),
    tag: element.tagName.toLowerCase(),
    role: elementRole(element),
    name: accessibleName(element),
    disabled: "disabled" in element && element.disabled === true,
    bounds: elementBounds(element),
  };
  return {
    ...base,
    ...(inputType === undefined ? {} : { inputType }),
    ...(href === undefined ? {} : { href }),
    ...(download ? { download: true } : {}),
  };
}

function pageText(): string {
  const body = document.body;
  const text = typeof body.innerText === "string" ? body.innerText : body.textContent;
  return compactText(text, MAX_VISIBLE_TEXT);
}

export class PageObserver {
  constructor(
    private readonly registry: ElementRegistry,
    private readonly youtube = new YouTubeAdapter(),
  ) {}

  observe(): PageSnapshot {
    const generation = this.registry.beginObservation();
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR));
    const elements = candidates
      .filter(isVisible)
      .slice(0, MAX_ELEMENTS)
      .map((element) => observeElement(element, this.registry));
    const youtube = this.youtube.getState();
    return {
      generation,
      url: location.href,
      title: document.title,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      },
      visibleText: pageText(),
      elements,
      ...(youtube === undefined ? {} : { youtube }),
    };
  }
}
