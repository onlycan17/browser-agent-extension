import { describe, expect, it } from "vitest";
import {
  consumeScreenshotConsent,
  resetScreenshotConsent,
} from "../src/sidepanel/screenshot-consent";

describe("screenshot consent", () => {
  it("consumes consent for one request only", () => {
    const control = { checked: true };

    expect(consumeScreenshotConsent(control)).toBe(true);
    expect(control.checked).toBe(false);
    expect(consumeScreenshotConsent(control)).toBe(false);
  });

  it("resets consent when a run closes", () => {
    const control = { checked: true };

    resetScreenshotConsent(control);

    expect(control.checked).toBe(false);
  });
});
