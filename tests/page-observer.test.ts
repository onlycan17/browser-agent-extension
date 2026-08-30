import { beforeEach, describe, expect, it, vi } from "vitest";
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
    Reflect.deleteProperty(document, "elementFromPoint");
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

  it("exposes localized video transcript controls on non-YouTube pages", () => {
    const more = appendVisible(document.createElement("button"));
    more.textContent = "더보기";
    const transcript = appendVisible(document.createElement("button"));
    transcript.setAttribute("aria-label", "스크립트");

    const snapshot = new PageObserver(new ElementRegistry()).observe();

    expect(snapshot.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "button", name: "더보기" }),
        expect.objectContaining({ role: "button", name: "스크립트" }),
      ]),
    );
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

  it("exposes autocomplete metadata without exposing the input value", () => {
    const code = appendVisible(document.createElement("input"));
    code.type = "text";
    code.autocomplete = "one-time-code";
    code.value = "654321";
    code.setAttribute("aria-label", "Code");

    const snapshot = new PageObserver(new ElementRegistry()).observe();

    expect(snapshot.elements[0]).toMatchObject({
      name: "Code",
      inputType: "text",
      autocomplete: "one-time-code",
    });
    expect(JSON.stringify(snapshot)).not.toContain("654321");
  });

  it("exposes sensitive autocomplete metadata on non-input editable fields", () => {
    const code = appendVisible(document.createElement("textarea"));
    code.setAttribute("autocomplete", "one-time-code");
    code.setAttribute("aria-label", "Code");

    const snapshot = new PageObserver(new ElementRegistry()).observe();

    expect(snapshot.elements[0]).toMatchObject({
      name: "Code",
      autocomplete: "one-time-code",
    });
  });

  it("limits visible text to the viewport and excludes editable drafts", () => {
    const visible = appendVisible(document.createElement("p"));
    visible.textContent = "PUBLIC-VISIBLE-TEXT";
    const draft = appendVisible(document.createElement("div"));
    draft.setAttribute("contenteditable", "true");
    draft.textContent = "PRIVATE-EDITABLE-DRAFT";
    const offscreen = document.createElement("p");
    offscreen.textContent = "PRIVATE-OFFSCREEN-TEXT";
    offscreen.getBoundingClientRect = () => ({
      x: 10,
      y: 2000,
      width: 120,
      height: 32,
      top: 2000,
      right: 130,
      bottom: 2032,
      left: 10,
      toJSON: () => ({}),
    });
    document.body.append(offscreen);

    const snapshot = new PageObserver(new ElementRegistry()).observe();

    expect(snapshot.visibleText).toContain("PUBLIC-VISIBLE-TEXT");
    expect(snapshot.visibleText).not.toContain("PRIVATE-EDITABLE-DRAFT");
    expect(snapshot.visibleText).not.toContain("PRIVATE-OFFSCREEN-TEXT");
    expect(JSON.stringify(snapshot)).not.toContain("PRIVATE-EDITABLE-DRAFT");
    expect(JSON.stringify(snapshot)).not.toContain("PRIVATE-OFFSCREEN-TEXT");
  });

  it("includes only visible words from a text node that crosses the viewport", () => {
    const paragraph = appendVisible(document.createElement("p"));
    paragraph.textContent = "VISIBLE-WORD OFFSCREEN-WORD";
    vi.spyOn(document, "createRange").mockImplementation(() => {
      let startOffset = 0;
      return {
        selectNodeContents: () => undefined,
        setStart: (_node: Node, offset: number) => {
          startOffset = offset;
        },
        setEnd: () => undefined,
        getBoundingClientRect: () => ({
          x: 10,
          y: startOffset === 0 ? 12 : 2000,
          width: 100,
          height: 20,
          top: startOffset === 0 ? 12 : 2000,
          right: 110,
          bottom: startOffset === 0 ? 32 : 2020,
          left: 10,
          toJSON: () => ({}),
        }),
      } as unknown as Range;
    });

    const snapshot = new PageObserver(new ElementRegistry()).observe();

    expect(snapshot.visibleText).toContain("VISIBLE-WORD");
    expect(snapshot.visibleText).not.toContain("OFFSCREEN-WORD");
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

  it("excludes an interactive element covered by another element", () => {
    const button = appendVisible(document.createElement("button"));
    button.textContent = "Covered";
    const overlay = appendVisible(document.createElement("div"));
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => overlay,
    });

    const snapshot = new PageObserver(new ElementRegistry()).observe();

    expect(snapshot.elements.find((item) => item.name === "Covered")).toBeUndefined();
  });

  it("exposes bounded select and checkbox state without input values", () => {
    const select = appendVisible(document.createElement("select"));
    select.setAttribute("aria-label", "Region");
    select.append(new Option("Seoul", "private-seoul", true, true));
    select.append(new Option("Busan", "private-busan"));
    const checkbox = appendVisible(document.createElement("input"));
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.value = "private-checkbox-value";
    checkbox.setAttribute("aria-label", "Newsletter");

    const snapshot = new PageObserver(new ElementRegistry()).observe();

    expect(snapshot.elements.find((item) => item.name === "Region")).toMatchObject({
      options: [
        { label: "Seoul", selected: true, disabled: false },
        { label: "Busan", selected: false, disabled: false },
      ],
    });
    expect(snapshot.elements.find((item) => item.name === "Newsletter")).toMatchObject({
      checked: true,
    });
    expect(JSON.stringify(snapshot)).not.toContain("private-seoul");
    expect(JSON.stringify(snapshot)).not.toContain("private-checkbox-value");
  });

  it("registers a visible scrollable ancestor of an interactive element", () => {
    const scroller = appendVisible(document.createElement("section"));
    scroller.setAttribute("aria-label", "Results");
    scroller.style.overflowY = "auto";
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 500 },
    });
    const button = document.createElement("button");
    button.textContent = "Item";
    makeVisible(button);
    scroller.append(button);

    const snapshot = new PageObserver(new ElementRegistry()).observe();

    expect(snapshot.elements.find((item) => item.name === "Results")).toMatchObject({
      scrollableY: true,
    });
  });

  it("collects interactive elements inside open shadow roots", () => {
    const host = appendVisible(document.createElement("div"));
    const shadow = host.attachShadow({ mode: "open" });
    const button = document.createElement("button");
    button.textContent = "Shadow action";
    button.setAttribute("aria-label", "Shadow action");
    makeVisible(button);
    shadow.append(button);

    const registry = new ElementRegistry();
    const snapshot = new PageObserver(registry).observe();

    expect(snapshot.elements).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Shadow action", role: "button" })]),
    );
    const shadowElement = snapshot.elements.find((item) => item.name === "Shadow action");
    expect(registry.resolve(snapshot.generation, shadowElement?.id ?? "")).not.toBeNull();
  });

  it("hides shadow children whose host is hidden without leaving the tree", () => {
    const host = appendVisible(document.createElement("div"));
    host.style.display = "none";
    const shadow = host.attachShadow({ mode: "open" });
    const button = document.createElement("button");
    button.textContent = "Hidden shadow action";
    makeVisible(button);
    shadow.append(button);

    const snapshot = new PageObserver(new ElementRegistry()).observe();

    expect(snapshot.elements.find((item) => item.name === "Hidden shadow action")).toBeUndefined();
  });

  it("collects interactive elements inside same-origin iframes", () => {
    const frame = appendVisible(document.createElement("iframe"));
    const frameDoc = frame.contentDocument;
    const frameWin = frameDoc?.defaultView;
    if (frameDoc === null || frameWin == null) {
      throw new Error("jsdom did not provide a same-origin frame document.");
    }
    const button = frameDoc.createElement("button");
    button.textContent = "Frame action";
    button.setAttribute("aria-label", "Frame action");
    makeVisible(button);
    frameDoc.body.append(button);

    const snapshot = new PageObserver(new ElementRegistry()).observe();

    expect(snapshot.elements).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Frame action", role: "button" })]),
    );
  });

  it("skips cross-origin frames whose documents are inaccessible", () => {
    const frame = appendVisible(document.createElement("iframe"));
    Object.defineProperty(frame, "contentDocument", { value: null });
    const snapshot = new PageObserver(new ElementRegistry()).observe();

    expect(snapshot.elements).toEqual([]);
  });

  it("collects tab controls so transcript tabs stay reachable", () => {
    const tab = appendVisible(document.createElement("div"));
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-label", "스크립트");
    tab.textContent = "스크립트";

    const snapshot = new PageObserver(new ElementRegistry()).observe();

    expect(snapshot.elements).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "스크립트", role: "tab" })]),
    );
  });
});
