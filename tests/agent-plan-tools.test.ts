import { describe, expect, it } from "vitest";
import type { ToolCall } from "../src/shared/llm";
import { parsePlanCall, toolCallSignature } from "../src/background/agent-tools";

function planTool(name: string, argumentString: string): ToolCall {
  return { id: `call-${name}`, type: "function", function: { name, arguments: argumentString } };
}

describe("plan tools", () => {
  it("parses a bounded create_plan call", () => {
    const call = planTool("create_plan", '{"steps":["Open settings","Save the form"]}');

    expect(parsePlanCall(call)).toEqual({
      name: "create_plan",
      steps: ["Open settings", "Save the form"],
    });
    expect(toolCallSignature(call)).toContain("create_plan:");
  });

  it.each([
    {
      label: "too many steps",
      name: "create_plan",
      argumentString: `{"steps":${JSON.stringify(
        Array.from({ length: 11 }, (_, index) => `Step ${String(index)}`),
      )}}`,
    },
    { label: "empty step text", name: "create_plan", argumentString: '{"steps":["   "]}' },
    {
      label: "overlong step",
      name: "create_plan",
      argumentString: `{"steps":["${"x".repeat(201)}"]}`,
    },
    {
      label: "unknown keys",
      name: "create_plan",
      argumentString: '{"steps":["One"],"extra":true}',
    },
    {
      label: "non-integer progress",
      name: "update_plan",
      argumentString: '{"completedSteps":1.5,"currentStep":"Save"}',
    },
    { label: "missing current step", name: "update_plan", argumentString: '{"completedSteps":1}' },
  ] satisfies { label: string; name: string; argumentString: string }[])(
    "rejects an invalid plan call: $label",
    ({ name, argumentString }) => {
      expect(parsePlanCall(planTool(name, argumentString))).toBeNull();
    },
  );

  it("parses an update_plan call", () => {
    const call = planTool("update_plan", '{"completedSteps":2,"currentStep":"Review"}');

    expect(parsePlanCall(call)).toEqual({
      name: "update_plan",
      completedSteps: 2,
      currentStep: "Review",
    });
    expect(toolCallSignature(call)).toContain("update_plan:2:");
  });
});
