import type { ElementBounds, ObservedElement, ObservedOption, PageSnapshot } from "../shared/page";
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
  "[role='tab']",
  "[role='textbox']",
].join(",");
const MAX_ELEMENTS = 150;
const MAX_VISIBLE_TEXT = 12_000;
const MAX_FIELD_TEXT = 300;
const MAX_TEXT_NODES = 5_000;
const MAX_TEXT_RANGE_CHECKS = 20_000;
const MAX_SELECT_OPTIONS = 50;
const MAX_ELEMENT_SCAN = 30_000;
const MAX_FRAMES = 5;
const MAX_SHADOW_ROOTS = 50;

interface FrameContext {
  doc: Document;
  win: Window;
}

function elementContext(element: HTMLElement): FrameContext {
  const doc = element.ownerDocument;
  const win = doc.defaultView ?? window;
  return { doc, win };
}

function compactText(value: string | null | undefined, limit = MAX_FIELD_TEXT): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function composedParent(element: HTMLElement): HTMLElement | null {
  const parent = element.parentElement;
  if (parent !== null) return parent;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? (root.host as HTMLElement) : null;
}

function composedContains(ancestor: HTMLElement, node: Element | null): boolean {
  let current: Element | null = node;
  while (current !== null) {
    if (current === ancestor) return true;
    const root = current.getRootNode();
    current = root instanceof ShadowRoot ? root.host : null;
  }
  return false;
}

function isRendered(element: HTMLElement, ctx: FrameContext): boolean {
  for (
    let current: HTMLElement | null = element;
    current !== null;
    current = composedParent(current)
  ) {
    const style = ctx.win.getComputedStyle(current);
    if (
      current.hidden === true ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return false;
    }
  }
  return true;
}

function isInViewport(
  win: Window,
  rect: Pick<DOMRect, "top" | "right" | "bottom" | "left" | "width" | "height">,
): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;
  return (
    rect.bottom > 0 && rect.right > 0 && rect.top < win.innerHeight && rect.left < win.innerWidth
  );
}

function isVisible(element: HTMLElement): boolean {
  const ctx = elementContext(element);
  if (!isRendered(element, ctx) || ctx.win.getComputedStyle(element).pointerEvents === "none")
    return false;
  return isInViewport(ctx.win, element.getBoundingClientRect());
}

export function elementIsUnobscured(element: HTMLElement): boolean {
  const ctx = elementContext(element);
  if (typeof ctx.doc.elementFromPoint !== "function") return true;
  const rect = element.getBoundingClientRect();
  const x = Math.min(Math.max(rect.left + rect.width / 2, 0), Math.max(ctx.win.innerWidth - 1, 0));
  const y = Math.min(Math.max(rect.top + rect.height / 2, 0), Math.max(ctx.win.innerHeight - 1, 0));
  const hit = ctx.doc.elementFromPoint(x, y);
  return hit === null || hit === element || composedContains(element, hit);
}

function isInteractable(element: HTMLElement): boolean {
  return isVisible(element) && elementIsUnobscured(element);
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
  if (ids.length === 0) return "";
  const root = element.getRootNode();
  const labels = ids.map((id) =>
    root instanceof ShadowRoot
      ? root.getElementById(id)?.textContent
      : document.getElementById(id)?.textContent,
  );
  return compactText(labels.join(" "));
}

function isExplicitlyEditable(element: HTMLElement): boolean {
  const value = element.getAttribute("contenteditable")?.toLowerCase();
  return (
    element.isContentEditable || value === "" || value === "true" || value === "plaintext-only"
  );
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
  if (isExplicitlyEditable(element)) return compactText(element.getAttribute("title"));
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
  return isExplicitlyEditable(element) ? "textbox" : element.tagName.toLowerCase();
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

function observedOptions(element: HTMLElement): ObservedOption[] | undefined {
  if (!(element instanceof HTMLSelectElement)) return undefined;
  return Array.from(element.options)
    .slice(0, MAX_SELECT_OPTIONS)
    .map((option) => ({
      label: compactText(option.label),
      selected: option.selected,
      disabled: option.disabled,
    }));
}

function scrollability(
  element: HTMLElement,
  ctx: FrameContext,
): {
  scrollableX: boolean;
  scrollableY: boolean;
} {
  const style = ctx.win.getComputedStyle(element);
  const scrollableX =
    /(auto|scroll)/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
  const scrollableY =
    /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
  return { scrollableX, scrollableY };
}

function observedChecked(element: HTMLElement): boolean | undefined {
  if (!(element instanceof HTMLInputElement)) return undefined;
  return element.type === "checkbox" || element.type === "radio" ? element.checked : undefined;
}

function describeElement(element: HTMLElement, id: string): ObservedElement {
  const ctx = elementContext(element);
  const inputType =
    element instanceof HTMLInputElement || element instanceof HTMLButtonElement
      ? element.type
      : undefined;
  const href = safeLinkOrigin(element);
  const autocomplete = compactText(element.getAttribute("autocomplete"));
  const download = element instanceof HTMLAnchorElement && element.hasAttribute("download");
  const checked = observedChecked(element);
  const options = observedOptions(element);
  const { scrollableX, scrollableY } = scrollability(element, ctx);
  const base = {
    id,
    tag: element.tagName.toLowerCase(),
    role: elementRole(element),
    name: accessibleName(element),
    disabled: "disabled" in element && element.disabled === true,
    bounds: elementBounds(element),
  };
  return {
    ...base,
    ...(inputType === undefined ? {} : { inputType }),
    ...(autocomplete.length === 0 ? {} : { autocomplete }),
    ...(href === undefined ? {} : { href }),
    ...(download ? { download: true } : {}),
    ...(checked === undefined ? {} : { checked }),
    ...(options === undefined ? {} : { options }),
    ...(scrollableX ? { scrollableX: true } : {}),
    ...(scrollableY ? { scrollableY: true } : {}),
  };
}

function observeElement(element: HTMLElement, registry: ElementRegistry): ObservedElement {
  return describeElement(element, registry.register(element));
}

function sameOptionalValue(
  first: string | boolean | undefined,
  second: string | boolean | undefined,
): boolean {
  return first === second;
}

function optionsMatch(
  first: ObservedOption[] | undefined,
  second: ObservedOption[] | undefined,
): boolean {
  if (first === undefined || second === undefined) return first === second;
  return (
    first.length === second.length &&
    first.every((option, index) => {
      const other = second[index];
      return (
        option.label === other?.label &&
        option.selected === other.selected &&
        option.disabled === other.disabled
      );
    })
  );
}

function boundsMatch(first: ElementBounds, second: ElementBounds): boolean {
  const tolerance = (value: number): number => Math.max(4, Math.abs(value) * 0.1);
  return (
    Math.abs(first.x - second.x) <= tolerance(second.width) &&
    Math.abs(first.y - second.y) <= tolerance(second.height) &&
    Math.abs(first.width - second.width) <= tolerance(second.width) &&
    Math.abs(first.height - second.height) <= tolerance(second.height)
  );
}

export function elementMatchesObservation(
  element: HTMLElement,
  expected: ObservedElement,
): boolean {
  if (!isVisible(element)) return false;
  const current = describeElement(element, expected.id);
  return (
    current.tag === expected.tag &&
    current.role === expected.role &&
    current.name === expected.name &&
    current.disabled === expected.disabled &&
    sameOptionalValue(current.inputType, expected.inputType) &&
    sameOptionalValue(current.autocomplete, expected.autocomplete) &&
    sameOptionalValue(current.href, expected.href) &&
    sameOptionalValue(current.download, expected.download) &&
    sameOptionalValue(current.checked, expected.checked) &&
    optionsMatch(current.options, expected.options) &&
    sameOptionalValue(current.scrollableX, expected.scrollableX) &&
    sameOptionalValue(current.scrollableY, expected.scrollableY) &&
    boundsMatch(current.bounds, expected.bounds)
  );
}

function scrollableAncestors(elements: readonly HTMLElement[]): HTMLElement[] {
  const found = new Set<HTMLElement>();
  for (const element of elements) {
    for (
      let current = composedParent(element);
      current !== null;
      current = composedParent(current)
    ) {
      const { scrollableX, scrollableY } = scrollability(current, elementContext(current));
      if ((scrollableX || scrollableY) && isInteractable(current)) found.add(current);
    }
  }
  return [...found];
}

function isEditableText(element: HTMLElement): boolean {
  for (
    let current: HTMLElement | null = element;
    current !== null;
    current = composedParent(current)
  ) {
    if (
      current instanceof HTMLInputElement ||
      current instanceof HTMLTextAreaElement ||
      current instanceof HTMLSelectElement
    ) {
      return true;
    }
    if (isExplicitlyEditable(current)) return true;
  }
  return false;
}

function visibleTextParts(
  ctx: FrameContext,
  node: Text,
  parent: HTMLElement,
  remainingRangeChecks: number,
): { parts: string[]; rangeChecks: number } {
  const range = ctx.doc.createRange();
  range.selectNodeContents(node);
  if (typeof range.getBoundingClientRect !== "function") {
    return isInViewport(ctx.win, parent.getBoundingClientRect())
      ? { parts: [node.data], rangeChecks: 0 }
      : { parts: [], rangeChecks: 0 };
  }
  const parts: string[] = [];
  let rangeChecks = 0;
  for (const match of node.data.matchAll(/\S+\s*/g)) {
    if (rangeChecks >= remainingRangeChecks) break;
    range.setStart(node, match.index);
    range.setEnd(node, match.index + match[0].length);
    rangeChecks += 1;
    if (isInViewport(ctx.win, range.getBoundingClientRect())) parts.push(match[0]);
  }
  return { parts, rangeChecks };
}

function rootText(ctx: FrameContext, root: ParentNode): string {
  const walker = ctx.doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const text: string[] = [];
  let textLength = 0;
  let visitedTextNodes = 0;
  let rangeChecks = 0;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (!(node instanceof Text) || node.data.trim().length === 0) continue;
    visitedTextNodes += 1;
    if (visitedTextNodes > MAX_TEXT_NODES || rangeChecks >= MAX_TEXT_RANGE_CHECKS) break;
    const parent = node.parentElement;
    if (parent === null || ["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(parent.tagName))
      continue;
    if (isEditableText(parent) || !isRendered(parent, ctx)) continue;
    const visible = visibleTextParts(ctx, node, parent, MAX_TEXT_RANGE_CHECKS - rangeChecks);
    rangeChecks += visible.rangeChecks;
    text.push(...visible.parts);
    textLength += visible.parts.reduce((length, part) => length + part.length, 0);
    if (textLength >= MAX_VISIBLE_TEXT) break;
  }
  return compactText(text.join(" "), MAX_VISIBLE_TEXT);
}

function openShadowRoots(ctx: FrameContext): ShadowRoot[] {
  const roots: ShadowRoot[] = [];
  let scanned = 0;
  for (const element of ctx.doc.querySelectorAll<HTMLElement>("*")) {
    scanned += 1;
    if (scanned > MAX_ELEMENT_SCAN) break;
    if (roots.length >= MAX_SHADOW_ROOTS) break;
    if (element.shadowRoot !== null) roots.push(element.shadowRoot);
  }
  return roots;
}

function sameOriginFrameContexts(ctx: FrameContext): FrameContext[] {
  const frames: FrameContext[] = [];
  for (const iframe of Array.from(ctx.doc.querySelectorAll("iframe"))) {
    if (frames.length >= MAX_FRAMES) break;
    const frameDoc = iframe.contentDocument;
    if (frameDoc === null) continue;
    const frameWin = frameDoc.defaultView;
    if (frameWin === null) continue;
    if (!isInteractable(iframe)) continue;
    frames.push({ doc: frameDoc, win: frameWin });
  }
  return frames;
}

function interactiveCandidates(ctx: FrameContext): HTMLElement[] {
  const elements = Array.from(ctx.doc.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR));
  for (const root of openShadowRoots(ctx)) {
    elements.push(...root.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR));
  }
  return elements;
}

function pageText(ctx: FrameContext): string {
  const parts = [rootText(ctx, ctx.doc.body)];
  for (const root of openShadowRoots(ctx)) {
    parts.push(rootText(ctx, root));
  }
  return compactText(parts.join(" "), MAX_VISIBLE_TEXT);
}

export class PageObserver {
  constructor(
    private readonly registry: ElementRegistry,
    private readonly youtube = new YouTubeAdapter(),
  ) {}

  observe(): PageSnapshot {
    const generation = this.registry.beginObservation();
    const topCtx: FrameContext = { doc: document, win: window };
    const frames = [topCtx, ...sameOriginFrameContexts(topCtx)];
    const elements: ObservedElement[] = [];
    const seen = new Set<HTMLElement>();
    for (const ctx of frames) {
      if (elements.length >= MAX_ELEMENTS) break;
      const interactive = interactiveCandidates(ctx);
      const candidates = [...interactive, ...scrollableAncestors(interactive)];
      for (const element of [...new Set(candidates)]) {
        if (elements.length >= MAX_ELEMENTS) break;
        if (seen.has(element)) continue;
        if (!isInteractable(element)) continue;
        seen.add(element);
        elements.push(observeElement(element, this.registry));
      }
    }
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
      visibleText: pageText(topCtx),
      elements,
      ...(youtube === undefined ? {} : { youtube }),
    };
  }
}
