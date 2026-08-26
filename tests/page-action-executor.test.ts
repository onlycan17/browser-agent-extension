import { beforeEach, describe, expect, it, vi } from "vitest";
import { ElementRegistry } from "../src/content/element-registry";
import { ActionExecutionError, PageActionExecutor } from "../src/content/page-action-executor";

function register(element: HTMLElement) {
  element.getBoundingClientRect = () => ({
    x: 10,
    y: 10,
    width: 120,
    height: 32,
    top: 10,
    right: 130,
    bottom: 42,
    left: 10,
    toJSON: () => ({}),
  });
  document.body.append(element);
  element.scrollIntoView = vi.fn();
  const registry = new ElementRegistry();
  const generation = registry.beginObservation();
  const elementId = registry.register(element);
  return { executor: new PageActionExecutor(registry), registry, generation, elementId };
}

function guard(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return {
    id: "e-1-1",
    tag: element.tagName.toLowerCase(),
    role: element instanceof HTMLButtonElement ? "button" : "textbox",
    name: element.getAttribute("aria-label") ?? element.textContent,
    disabled: "disabled" in element && element.disabled === true,
    bounds: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
    ...(element instanceof HTMLInputElement ? { inputType: element.type } : {}),
    ...(element.getAttribute("autocomplete") !== null
      ? { autocomplete: element.getAttribute("autocomplete") ?? "" }
      : {}),
  };
}

describe("PageActionExecutor", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("uses the native setter and emits input events", () => {
    const input = document.createElement("input");
    const changes: string[] = [];
    input.addEventListener("input", () => changes.push("input"));
    input.addEventListener("change", () => changes.push("change"));
    const { executor, generation, elementId } = register(input);

    executor.typeText(generation, elementId, "hello", true, guard(input));

    expect(input.value).toBe("hello");
    expect(changes).toEqual(["input", "change"]);
    expect(document.activeElement).toBe(input);
  });

  it("rejects a click when the approved target changes before execution", () => {
    const button = document.createElement("button");
    button.textContent = "Safe action";
    const clicked = vi.fn();
    button.addEventListener("click", clicked);
    const { executor, generation, elementId } = register(button);
    const expected = guard(button);
    button.textContent = "Changed action";
    button.style.opacity = "0";

    expect(() => executor.click(generation, elementId, expected)).toThrow(
      new ActionExecutionError(
        "STALE_ELEMENT",
        "The target changed after observation; observe it again.",
      ),
    );
    expect(clicked).not.toHaveBeenCalled();
  });

  it("rejects an unchanged label when the approved target becomes transparent", () => {
    const button = document.createElement("button");
    button.textContent = "Safe action";
    const clicked = vi.fn();
    button.addEventListener("click", clicked);
    const { executor, generation, elementId } = register(button);
    const expected = guard(button);
    button.style.opacity = "0";

    expect(() => executor.click(generation, elementId, expected)).toThrow(
      "The target changed after observation; observe it again.",
    );
    expect(clicked).not.toHaveBeenCalled();
  });

  it("rejects an approved target that moves before execution", () => {
    const button = document.createElement("button");
    button.textContent = "Safe action";
    const { executor, generation, elementId } = register(button);
    const expected = guard(button);
    button.getBoundingClientRect = () => ({
      x: 400,
      y: 400,
      width: 120,
      height: 32,
      top: 400,
      right: 520,
      bottom: 432,
      left: 400,
      toJSON: () => ({}),
    });

    expect(() => executor.click(generation, elementId, expected)).toThrow(
      "The target changed after observation; observe it again.",
    );
  });

  it("submits the focused form when Enter is approved", () => {
    const form = document.createElement("form");
    const input = document.createElement("input");
    input.setAttribute("aria-label", "Name");
    form.append(input);
    const requestSubmit = vi.fn();
    form.requestSubmit = requestSubmit;
    const { executor, registry, generation } = register(form);
    input.getBoundingClientRect = () => form.getBoundingClientRect();
    const inputId = registry.register(input);

    executor.typeText(generation, inputId, "Alice", true, guard(input));
    executor.pressKey("Enter");

    expect(document.activeElement).toBe(input);
    expect(requestSubmit).toHaveBeenCalledOnce();
  });

  it("rejects Enter when no actionable element is focused", () => {
    const executor = new PageActionExecutor(new ElementRegistry());

    expect(() => executor.pressKey("Enter")).toThrow(
      new ActionExecutionError("UNSAFE_ACTION", "No actionable element is focused."),
    );
  });

  it("does not submit when the focused field cancels Enter", () => {
    const form = document.createElement("form");
    const input = document.createElement("input");
    input.setAttribute("aria-label", "Name");
    input.addEventListener("keydown", (event) => {
      event.preventDefault();
    });
    form.append(input);
    const requestSubmit = vi.fn();
    form.requestSubmit = requestSubmit;
    const { executor, registry, generation } = register(form);
    input.getBoundingClientRect = () => form.getBoundingClientRect();
    const inputId = registry.register(input);

    executor.typeText(generation, inputId, "Alice", true, guard(input));
    executor.pressKey("Enter");

    expect(requestSubmit).not.toHaveBeenCalled();
  });

  it("blocks one-time-code inputs even when called directly", () => {
    const code = document.createElement("input");
    code.type = "text";
    code.autocomplete = "one-time-code";
    const { executor, generation, elementId } = register(code);

    expect(() => executor.typeText(generation, elementId, "654321", true, guard(code))).toThrow(
      new ActionExecutionError("UNSAFE_ACTION", "This input type cannot be edited."),
    );
  });

  it("blocks one-time-code textareas even when called directly", () => {
    const code = document.createElement("textarea");
    code.setAttribute("autocomplete", "one-time-code");
    const { executor, generation, elementId } = register(code);

    expect(() => executor.typeText(generation, elementId, "654321", true, guard(code))).toThrow(
      new ActionExecutionError("UNSAFE_ACTION", "This input type cannot be edited."),
    );
  });

  it("blocks protected inputs even when called directly", () => {
    const password = document.createElement("input");
    password.type = "password";
    const { executor, generation, elementId } = register(password);

    expect(() => executor.typeText(generation, elementId, "secret", true, guard(password))).toThrow(
      new ActionExecutionError("UNSAFE_ACTION", "This input type cannot be edited."),
    );
  });

  it("blocks input types outside the explicit text allowlist", () => {
    const number = document.createElement("input");
    number.type = "number";
    const { executor, generation, elementId } = register(number);

    expect(() => executor.typeText(generation, elementId, "42", true, guard(number))).toThrow(
      new ActionExecutionError("UNSAFE_ACTION", "This input type cannot be edited."),
    );
  });

  it("rejects stale generations", () => {
    const input = document.createElement("input");
    const { executor, generation, elementId } = register(input);

    expect(() => executor.typeText(generation + 1, elementId, "text", true, guard(input))).toThrow(
      new ActionExecutionError("STALE_ELEMENT", "The page changed; observe it again."),
    );
  });
});
