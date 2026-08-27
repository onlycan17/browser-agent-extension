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
  const style = window.getComputedStyle(element);
  const scrollableX =
    /(auto|scroll)/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
  const scrollableY =
    /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
  const role =
    element instanceof HTMLButtonElement
      ? "button"
      : element instanceof HTMLSelectElement
        ? "combobox"
        : element instanceof HTMLInputElement &&
            (element.type === "checkbox" || element.type === "radio")
          ? element.type
          : element.tagName.toLowerCase() === "section"
            ? "section"
            : "textbox";
  return {
    id: "e-1-1",
    tag: element.tagName.toLowerCase(),
    role,
    name: element.getAttribute("aria-label") ?? element.textContent,
    disabled: "disabled" in element && element.disabled === true,
    bounds: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
    ...(element instanceof HTMLInputElement || element instanceof HTMLButtonElement
      ? { inputType: element.type }
      : {}),
    ...(element.getAttribute("autocomplete") !== null
      ? { autocomplete: element.getAttribute("autocomplete") ?? "" }
      : {}),
    ...(element instanceof HTMLInputElement &&
    (element.type === "checkbox" || element.type === "radio")
      ? { checked: element.checked }
      : {}),
    ...(element instanceof HTMLSelectElement
      ? {
          options: Array.from(element.options)
            .slice(0, 50)
            .map((option) => ({
              label: option.label,
              selected: option.selected,
              disabled: option.disabled,
            })),
        }
      : {}),
    ...(scrollableX ? { scrollableX: true } : {}),
    ...(scrollableY ? { scrollableY: true } : {}),
  };
}

describe("PageActionExecutor", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    Reflect.deleteProperty(document, "elementFromPoint");
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

  it("rejects a target covered after observation", () => {
    const button = document.createElement("button");
    button.textContent = "Continue";
    const overlay = document.createElement("div");
    const clicked = vi.fn();
    button.addEventListener("click", clicked);
    const { executor, generation, elementId } = register(button);
    document.body.append(overlay);
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => overlay,
    });

    expect(() => executor.click(generation, elementId, guard(button))).toThrow(
      new ActionExecutionError("ELEMENT_OCCLUDED", "Another element is covering the target."),
    );
    expect(clicked).not.toHaveBeenCalled();
  });

  it("selects an option by observed label without accepting a raw selector", () => {
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Region");
    select.append(new Option("Seoul", "internal-1", true, true));
    select.append(new Option("Busan", "internal-2"));
    const events: string[] = [];
    select.addEventListener("input", () => events.push("input"));
    select.addEventListener("change", () => events.push("change"));
    const { executor, generation, elementId } = register(select);

    executor.selectOption(generation, elementId, "Busan", guard(select));

    expect(select.selectedOptions[0]?.label).toBe("Busan");
    expect(events).toEqual(["input", "change"]);
    expect(() => executor.selectOption(generation, elementId, "Missing", guard(select))).toThrow(
      new ActionExecutionError("ELEMENT_NOT_FOUND", "The requested option is unavailable."),
    );
  });

  it("rejects a select option that was outside the bounded observation", () => {
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Large option list");
    for (let index = 0; index < 51; index += 1) {
      select.append(new Option(`Option ${String(index + 1)}`, `internal-${String(index + 1)}`));
    }
    const { executor, generation, elementId } = register(select);

    expect(() => executor.selectOption(generation, elementId, "Option 51", guard(select))).toThrow(
      new ActionExecutionError("ELEMENT_NOT_FOUND", "The requested option is unavailable."),
    );
  });

  it("sets checkbox state and rejects clearing a radio button", () => {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.setAttribute("aria-label", "Newsletter");
    const changes: string[] = [];
    checkbox.addEventListener("change", () => changes.push("change"));
    const registered = register(checkbox);

    registered.executor.setChecked(
      registered.generation,
      registered.elementId,
      true,
      guard(checkbox),
    );

    expect(checkbox.checked).toBe(true);
    expect(changes).toEqual(["change"]);

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.checked = true;
    const radioRegistration = register(radio);
    expect(() =>
      radioRegistration.executor.setChecked(
        radioRegistration.generation,
        radioRegistration.elementId,
        false,
        guard(radio),
      ),
    ).toThrow(new ActionExecutionError("UNSAFE_ACTION", "A radio option cannot be cleared."));
  });

  it("scrolls a guarded nested container without smooth-scroll races", () => {
    const scroller = document.createElement("section");
    scroller.setAttribute("aria-label", "Results");
    scroller.style.overflowY = "auto";
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 500 },
    });
    const scrollBy = vi.fn();
    scroller.scrollBy = scrollBy;
    const { executor, generation, elementId } = register(scroller);

    executor.scrollElement(generation, elementId, "down", 400, guard(scroller));

    expect(scrollBy).toHaveBeenCalledWith({ top: 400, left: 0, behavior: "auto" });
  });
});
