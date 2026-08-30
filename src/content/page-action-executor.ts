import type { AllowedKey, PageActionResult } from "../shared/actions";
import type { ObservedElement } from "../shared/page";
import { isSensitiveAutocomplete } from "../shared/sensitive-input";
import { ElementRegistry } from "./element-registry";
import { elementIsUnobscured, elementMatchesObservation } from "./page-observer";

export type ActionExecutionCode =
  | "STALE_ELEMENT"
  | "ELEMENT_NOT_FOUND"
  | "ELEMENT_OCCLUDED"
  | "UNSAFE_ACTION"
  | "YOUTUBE_SEARCH_FAILED";

export class ActionExecutionError extends Error {
  constructor(
    readonly code: ActionExecutionCode,
    message: string,
  ) {
    super(message);
    this.name = "ActionExecutionError";
  }
}

const ALLOWED_INPUT_TYPES = new Set(["email", "search", "tel", "text", "url"]);

function isDisabled(element: HTMLElement): boolean {
  if (!("disabled" in element)) return false;
  return element.disabled === true;
}

function elementWindow(element: HTMLElement): Window {
  return element.ownerDocument.defaultView ?? window;
}

function isHidden(element: HTMLElement): boolean {
  const style = elementWindow(element).getComputedStyle(element);
  const hidden = element.hidden === true || element.hidden === "until-found";
  return hidden || style.display === "none" || style.visibility === "hidden";
}

function composedActiveElement(doc: Document): Element | null {
  let active: Element | null = doc.activeElement;
  for (;;) {
    if (!(active instanceof HTMLElement)) return active;
    const shadow = active.shadowRoot;
    if (shadow !== null && shadow.activeElement !== null) {
      active = shadow.activeElement;
      continue;
    }
    if (active instanceof HTMLIFrameElement) {
      const frameDoc = active.contentDocument;
      if (frameDoc !== null && frameDoc.activeElement !== null) {
        active = frameDoc.activeElement;
        continue;
      }
    }
    return active;
  }
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLTextAreaElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  if (descriptor?.set === undefined)
    throw new ActionExecutionError("UNSAFE_ACTION", "This field cannot be edited safely.");
  const setter = descriptor.set.bind(element);
  setter(value);
}

function dispatchInputEvents(element: HTMLElement, text: string): void {
  element.dispatchEvent(
    new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }),
  );
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function dispatchValueEvents(element: HTMLElement): void {
  element.dispatchEvent(new InputEvent("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function setNativeChecked(element: HTMLInputElement, checked: boolean): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");
  if (descriptor?.set === undefined) {
    throw new ActionExecutionError("UNSAFE_ACTION", "This control cannot be changed safely.");
  }
  descriptor.set.call(element, checked);
}

export class PageActionExecutor {
  constructor(private readonly registry: ElementRegistry) {}

  click(generation: number, elementId: string, expected: ObservedElement): PageActionResult {
    const element = this.resolve(generation, elementId);
    this.assertUnchanged(element, expected);
    this.assertUnobscured(element);
    if (isDisabled(element))
      throw new ActionExecutionError("UNSAFE_ACTION", "The target is disabled.");
    if (isHidden(element)) throw new ActionExecutionError("UNSAFE_ACTION", "The target is hidden.");
    element.scrollIntoView({ block: "center", inline: "center" });
    element.click();
    return { message: "Element clicked." };
  }

  typeText(
    generation: number,
    elementId: string,
    text: string,
    replace: boolean,
    expected: ObservedElement,
  ): PageActionResult {
    const element = this.resolve(generation, elementId);
    this.assertUnchanged(element, expected);
    this.assertUnobscured(element);
    if (isDisabled(element))
      throw new ActionExecutionError("UNSAFE_ACTION", "The target is disabled.");
    if (isHidden(element)) throw new ActionExecutionError("UNSAFE_ACTION", "The target is hidden.");
    if (isSensitiveAutocomplete(element.getAttribute("autocomplete") ?? undefined)) {
      throw new ActionExecutionError("UNSAFE_ACTION", "This input type cannot be edited.");
    }
    element.focus();
    if (composedActiveElement(element.ownerDocument) !== element)
      throw new ActionExecutionError("UNSAFE_ACTION", "This field could not be focused safely.");
    if (element instanceof HTMLInputElement) return this.typeIntoInput(element, text, replace);
    if (element instanceof HTMLTextAreaElement)
      return this.typeIntoTextArea(element, text, replace);
    if (!element.isContentEditable) {
      throw new ActionExecutionError("UNSAFE_ACTION", "The target is not an editable field.");
    }
    element.textContent = replace ? text : `${element.textContent}${text}`;
    dispatchInputEvents(element, text);
    return { message: "Text entered." };
  }

  pressKey(key: AllowedKey): PageActionResult {
    const composed = composedActiveElement(document);
    const target = composed instanceof HTMLElement ? composed : document.body;
    if (key === "Enter" && (target === document.body || target === document.documentElement)) {
      throw new ActionExecutionError("UNSAFE_ACTION", "No actionable element is focused.");
    }
    const accepted = target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
    if (key === "Enter" && accepted) this.applyEnterDefault(target);
    target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
    return { message: `Key ${key} pressed.` };
  }

  scroll(direction: "up" | "down" | "left" | "right", amount: number): PageActionResult {
    const vertical = direction === "up" ? -amount : direction === "down" ? amount : 0;
    const horizontal = direction === "left" ? -amount : direction === "right" ? amount : 0;
    window.scrollBy({ top: vertical, left: horizontal, behavior: "auto" });
    return { message: `Scrolled ${direction}.` };
  }

  selectOption(
    generation: number,
    elementId: string,
    optionLabel: string,
    expected: ObservedElement,
  ): PageActionResult {
    const element = this.resolve(generation, elementId);
    this.assertUnchanged(element, expected);
    this.assertUnobscured(element);
    if (!(element instanceof HTMLSelectElement)) {
      throw new ActionExecutionError("UNSAFE_ACTION", "The target is not a select control.");
    }
    const observedOptions =
      expected.options?.filter((option) => option.label === optionLabel) ?? [];
    if (observedOptions.length !== 1 || observedOptions[0]?.disabled === true) {
      throw new ActionExecutionError("ELEMENT_NOT_FOUND", "The requested option is unavailable.");
    }
    const options = Array.from(element.options).filter(
      (option) => option.label.replace(/\s+/g, " ").trim() === optionLabel,
    );
    const option = options[0];
    if (options.length !== 1 || option === undefined || option.disabled) {
      throw new ActionExecutionError("ELEMENT_NOT_FOUND", "The requested option is unavailable.");
    }
    if (option.selected) return { message: "Option was already selected." };
    element.selectedIndex = option.index;
    dispatchValueEvents(element);
    return { message: "Option selected." };
  }

  setChecked(
    generation: number,
    elementId: string,
    checked: boolean,
    expected: ObservedElement,
  ): PageActionResult {
    const element = this.resolve(generation, elementId);
    this.assertUnchanged(element, expected);
    this.assertUnobscured(element);
    if (
      !(element instanceof HTMLInputElement) ||
      (element.type !== "checkbox" && element.type !== "radio")
    ) {
      throw new ActionExecutionError("UNSAFE_ACTION", "The target is not a checkable control.");
    }
    if (element.type === "radio" && !checked) {
      throw new ActionExecutionError("UNSAFE_ACTION", "A radio option cannot be cleared.");
    }
    if (element.checked === checked) return { message: "Checked state was already set." };
    setNativeChecked(element, checked);
    dispatchValueEvents(element);
    return { message: "Checked state updated." };
  }

  scrollElement(
    generation: number,
    elementId: string,
    direction: "up" | "down" | "left" | "right",
    amount: number,
    expected: ObservedElement,
  ): PageActionResult {
    const element = this.resolve(generation, elementId);
    this.assertUnchanged(element, expected);
    this.assertUnobscured(element);
    const verticalDirection = direction === "up" || direction === "down";
    if (
      (verticalDirection && expected.scrollableY !== true) ||
      (!verticalDirection && expected.scrollableX !== true)
    ) {
      throw new ActionExecutionError(
        "UNSAFE_ACTION",
        "The target is not scrollable in that direction.",
      );
    }
    const vertical = direction === "up" ? -amount : direction === "down" ? amount : 0;
    const horizontal = direction === "left" ? -amount : direction === "right" ? amount : 0;
    element.scrollBy({ top: vertical, left: horizontal, behavior: "auto" });
    return { message: `Element scrolled ${direction}.` };
  }

  private resolve(generation: number, elementId: string): HTMLElement {
    const element = this.registry.resolve(generation, elementId);
    if (element === null)
      throw new ActionExecutionError("STALE_ELEMENT", "The page changed; observe it again.");
    if (!(element instanceof HTMLElement)) {
      throw new ActionExecutionError("ELEMENT_NOT_FOUND", "The target element is unavailable.");
    }
    return element;
  }

  private assertUnchanged(element: HTMLElement, expected: ObservedElement): void {
    if (elementMatchesObservation(element, expected)) return;
    throw new ActionExecutionError(
      "STALE_ELEMENT",
      "The target changed after observation; observe it again.",
    );
  }

  private assertUnobscured(element: HTMLElement): void {
    if (elementIsUnobscured(element)) return;
    throw new ActionExecutionError("ELEMENT_OCCLUDED", "Another element is covering the target.");
  }

  private applyEnterDefault(target: HTMLElement): void {
    if (target instanceof HTMLButtonElement) {
      target.click();
      return;
    }
    if (!(target instanceof HTMLInputElement) || target.form === null) return;
    const submitter = target.form.querySelector<HTMLButtonElement | HTMLInputElement>(
      "button[type='submit']:not(:disabled), input[type='submit']:not(:disabled)",
    );
    if (submitter === null) target.form.requestSubmit();
    else target.form.requestSubmit(submitter);
  }

  private typeIntoInput(
    element: HTMLInputElement,
    text: string,
    replace: boolean,
  ): PageActionResult {
    if (!ALLOWED_INPUT_TYPES.has(element.type) || element.readOnly) {
      throw new ActionExecutionError("UNSAFE_ACTION", "This input type cannot be edited.");
    }
    setNativeValue(element, replace ? text : `${element.value}${text}`);
    dispatchInputEvents(element, text);
    return { message: "Text entered." };
  }

  private typeIntoTextArea(
    element: HTMLTextAreaElement,
    text: string,
    replace: boolean,
  ): PageActionResult {
    if (element.readOnly)
      throw new ActionExecutionError("UNSAFE_ACTION", "This field is read-only.");
    setNativeValue(element, replace ? text : `${element.value}${text}`);
    dispatchInputEvents(element, text);
    return { message: "Text entered." };
  }
}
