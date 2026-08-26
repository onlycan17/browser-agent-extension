import type { AllowedKey, PageActionResult } from "../shared/actions";
import type { ObservedElement } from "../shared/page";
import { isSensitiveAutocomplete } from "../shared/sensitive-input";
import { ElementRegistry } from "./element-registry";
import { elementMatchesObservation } from "./page-observer";

export type ActionExecutionCode = "STALE_ELEMENT" | "ELEMENT_NOT_FOUND" | "UNSAFE_ACTION";

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

function isHidden(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const hidden = element.hidden === true || element.hidden === "until-found";
  return hidden || style.display === "none" || style.visibility === "hidden";
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

export class PageActionExecutor {
  constructor(private readonly registry: ElementRegistry) {}

  click(generation: number, elementId: string, expected: ObservedElement): PageActionResult {
    const element = this.resolve(generation, elementId);
    this.assertUnchanged(element, expected);
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
    if (isDisabled(element))
      throw new ActionExecutionError("UNSAFE_ACTION", "The target is disabled.");
    if (isHidden(element)) throw new ActionExecutionError("UNSAFE_ACTION", "The target is hidden.");
    if (isSensitiveAutocomplete(element.getAttribute("autocomplete") ?? undefined)) {
      throw new ActionExecutionError("UNSAFE_ACTION", "This input type cannot be edited.");
    }
    element.focus();
    if (document.activeElement !== element)
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
    const target =
      document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
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
    window.scrollBy({ top: vertical, left: horizontal, behavior: "smooth" });
    return { message: `Scrolled ${direction}.` };
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
