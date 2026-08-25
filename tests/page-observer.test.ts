import { beforeEach, describe, expect, it } from "vitest";
import { ElementRegistry } from "../src/content/element-registry";
import { PageObserver } from "../src/content/page-observer";

function makeVisible(element: HTMLElement, x = 10): void {
  element.getBoundingClientRect = () => ({
    x,
    y: 12,
    width: 120,
    height: 32,
    top: 12,
    right: x + 120,
    bottom: 44,
    left: x,
    toJSON: () => ({}),
  });
}

function appendVisible<T extends HTMLElement>(element: T): T {
  makeVisible(element);
  document.body.append(element);
  return element;
}

describe("PageObserver", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    document.title = "Fixture page";
  });

  it("collects visible interactive elements with short-lived IDs", () => {
    const button = appendVisible(document.createElement("button"));
    button.textContent = "Search";
    const registry = new ElementRegistry();
    const observer = new PageObserver(registry);

    const first = observer.observe();
    const second = observer.observe();

    expect(first.elements[0]).toMatchObject({ role: "button", name: "Search", disabled: false });
    expect(first.elements[0]?.id).not.toBe(second.elements[0]?.id);
    expect(registry.resolve(first.generation, first.elements[0]?.id ?? "")).toBeNull();
  });

  it("exposes only link origins to avoid leaking URL tokens", () => {
    const link = appendVisible(document.createElement("a"));
    link.href = "https://download.example/magic/secret?token=private#fragment";
    link.textContent = "Download";

    const snapshot = new PageObserver(new ElementRegistry()).observe();

    expect(snapshot.elements[0]).toMatchObject({ href: "https://download.example" });
    expect(JSON.stringify(snapshot)).not.toContain("secret");
    expect(JSON.stringify(snapshot)).not.toContain("private");
  });

  it("never exposes protected input values", () => {
    const password = appendVisible(document.createElement("input"));
    password.type = "password";
    password.value = "super-secret";
    password.setAttribute("aria-label", "Password");
    const file = appendVisible(document.createElement("input"));
    file.type = "file";
    const text = appendVisible(document.createElement("input"));
    text.type = "text";
    text.value = "safe value";
    text.setAttribute("aria-label", "Query");

    const snapshot = new PageObserver(new ElementRegistry()).observe();

    expect(snapshot.elements.find((item) => item.name === "Password")).not.toHaveProperty("value");
    expect(snapshot.elements.find((item) => item.inputType === "file")).not.toHaveProperty("value");
    expect(snapshot.elements.find((item) => item.name === "Query")).not.toHaveProperty("value");
    expect(JSON.stringify(snapshot)).not.toContain("super-secret");
    expect(JSON.stringify(snapshot)).not.toContain("safe value");
  });

  it("ignores elements outside the viewport", () => {
    const hidden = document.createElement("button");
    hidden.textContent = "Offscreen";
    hidden.getBoundingClientRect = () => ({
      x: -500,
      y: 0,
      width: 100,
      height: 20,
      top: 0,
      right: -400,
      bottom: 20,
      left: -500,
      toJSON: () => ({}),
    });
    document.body.append(hidden);

    const snapshot = new PageObserver(new ElementRegistry()).observe();

    expect(snapshot.elements).toHaveLength(0);
  });
});
