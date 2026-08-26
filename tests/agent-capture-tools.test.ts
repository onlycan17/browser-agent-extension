import { describe, expect, it } from "vitest";
import { agentTools, isCaptureScreenCall } from "../src/background/agent-tools";
import type { ToolCall } from "../src/shared/llm";

function captureCall(argumentsJson: string): ToolCall {
  return {
    id: "capture-1",
    type: "function",
    function: { name: "capture_screen", arguments: argumentsJson },
  };
}

describe("agent screenshot capability", () => {
  it("exposes capture_screen only for a screenshot-enabled run", () => {
    const disabled = agentTools(false).map((tool) => tool.function.name);
    const enabled = agentTools(true).map((tool) => tool.function.name);

    expect(disabled).not.toContain("capture_screen");
    expect(enabled).toContain("capture_screen");
  });

  it("accepts only a zero-argument capture_screen call", () => {
    expect(isCaptureScreenCall(captureCall("{}"))).toBe(true);
    expect(isCaptureScreenCall(captureCall('{"selector":"body"}'))).toBe(false);
    expect(
      isCaptureScreenCall({
        ...captureCall("{}"),
        function: { name: "click_element", arguments: "{}" },
      }),
    ).toBe(false);
  });
});
