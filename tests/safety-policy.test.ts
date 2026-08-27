import { describe, expect, it } from "vitest";
import { SafetyPolicy } from "../src/background/safety-policy";
import type { ObservedElement } from "../src/shared/page";

function element(overrides: Partial<ObservedElement> = {}): ObservedElement {
  return {
    id: "e-1-1",
    tag: "button",
    role: "button",
    name: "Continue",
    disabled: false,
    bounds: { x: 0, y: 0, width: 100, height: 30 },
    ...overrides,
  };
}

const policy = new SafetyPolicy();

describe("SafetyPolicy", () => {
  it.each(["Password", "OTP code", "카드 번호", "인증 코드"])(
    "denies sensitive field %s",
    (name) => {
      expect(policy.evaluate({ action: "type_text", element: element({ name }) }).outcome).toBe(
        "deny",
      );
    },
  );

  it.each(["one-time-code", "current-password", "new-password", "cc-number", "cc-csc"])(
    "denies sensitive autocomplete metadata %s even with a neutral label",
    (autocomplete) => {
      expect(
        policy.evaluate({
          action: "type_text",
          element: element({ name: "Code", inputType: "text", autocomplete }),
        }),
      ).toMatchObject({ outcome: "deny" });
    },
  );

  it("denies a section-scoped one-time-code autocomplete value", () => {
    expect(
      policy.evaluate({
        action: "type_text",
        element: element({
          name: "Code",
          inputType: "text",
          autocomplete: "section-checkout one-time-code webauthn",
        }),
      }),
    ).toMatchObject({ outcome: "deny" });
  });

  it.each(["Send message", "Buy now", "Delete account", "로그인", "결제하기"])(
    "requires confirmation for %s",
    (name) => {
      expect(
        policy.evaluate({
          action: "click",
          element: element({ name }),
          pageUrl: "https://example.com/",
        }).outcome,
      ).toBe("confirm");
    },
  );

  it("requires confirmation for neutral submit buttons", () => {
    const decision = policy.evaluate({
      action: "click",
      element: element({ tag: "button", inputType: "submit", name: "Continue" }),
      pageUrl: "https://example.com/",
    });

    expect(decision.outcome).toBe("confirm");
  });

  it("requires confirmation for download links", () => {
    const decision = policy.evaluate({
      action: "click",
      element: element({ role: "link", href: "https://example.com/file", download: true }),
      pageUrl: "https://example.com/",
    });

    expect(decision.outcome).toBe("confirm");
  });

  it("requires confirmation for external navigation", () => {
    const decision = policy.evaluate({
      action: "click",
      element: element({ role: "link", href: "https://other.example/" }),
      pageUrl: "https://example.com/",
    });

    expect(decision.outcome).toBe("confirm");
  });

  it("requires confirmation for neutral clicks with site-defined behavior", () => {
    const decision = policy.evaluate({
      action: "click",
      element: element({ name: "Continue" }),
      pageUrl: "https://example.com/",
    });

    expect(decision.outcome).toBe("confirm");
  });

  it("allows ordinary text entry and scrolling", () => {
    expect(
      policy.evaluate({ action: "type_text", element: element({ inputType: "text" }) }),
    ).toEqual({
      outcome: "allow",
    });
    expect(policy.evaluate({ action: "scroll" })).toEqual({ outcome: "allow" });
  });

  it("requires confirmation before Enter", () => {
    expect(policy.evaluate({ action: "press_key", key: "Enter" }).outcome).toBe("confirm");
  });

  it("requires confirmation for form selection changes but allows nested scrolling", () => {
    expect(policy.evaluate({ action: "select_option", element: element() }).outcome).toBe(
      "confirm",
    );
    expect(policy.evaluate({ action: "set_checked", element: element() }).outcome).toBe("confirm");
    expect(policy.evaluate({ action: "scroll_element", element: element() })).toEqual({
      outcome: "allow",
    });
  });
});
