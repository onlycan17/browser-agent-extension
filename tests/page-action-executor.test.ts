import { beforeEach, describe, expect, it, vi } from "vitest";
import { ElementRegistry } from "../src/content/element-registry";
import { ActionExecutionError, PageActionExecutor } from "../src/content/page-action-executor";

function register(element: HTMLElement) {
  document.body.append(element);
  element.scrollIntoView = vi.fn();
  const registry = new ElementRegistry();
  const generation = registry.beginObservation();
  const elementId = registry.register(element);
  return { executor: new PageActionExecutor(registry), generation, elementId };
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

    executor.typeText(generation, elementId, "hello", true);

    expect(input.value).toBe("hello");
    expect(changes).toEqual(["input", "change"]);
  });

  it("blocks protected inputs even when called directly", () => {
    const password = document.createElement("input");
    password.type = "password";
    const { executor, generation, elementId } = register(password);

    expect(() => executor.typeText(generation, elementId, "secret", true)).toThrow(
      new ActionExecutionError("UNSAFE_ACTION", "This input type cannot be edited."),
    );
  });

  it("blocks input types outside the explicit text allowlist", () => {
    const number = document.createElement("input");
    number.type = "number";
    const { executor, generation, elementId } = register(number);

    expect(() => executor.typeText(generation, elementId, "42", true)).toThrow(
      new ActionExecutionError("UNSAFE_ACTION", "This input type cannot be edited."),
    );
  });

  it("rejects stale generations", () => {
    const input = document.createElement("input");
    const { executor, generation, elementId } = register(input);

    expect(() => executor.typeText(generation + 1, elementId, "text", true)).toThrow(
      new ActionExecutionError("STALE_ELEMENT", "The page changed; observe it again."),
    );
  });
});
