import { describe, expect, it, vi } from "vitest";
import type { AgentApprovalEvent, AgentEvent } from "../src/shared/agent";
import type { ToolCall } from "../src/shared/llm";
import type { PageSnapshot } from "../src/shared/page";
import { AGENT_TOOLS, AgentToolExecutor } from "../src/background/agent-tools";
import { ApprovalManager } from "../src/background/approval-manager";
import { SafetyPolicy } from "../src/background/safety-policy";

const snapshot: PageSnapshot = {
  generation: 1,
  url: "https://example.com/",
  title: "Example",
  viewport: { width: 1000, height: 800, scrollX: 0, scrollY: 0 },
  visibleText: "Submit form",
  elements: [
    {
      id: "submit",
      tag: "button",
      role: "button",
      name: "Submit",
      disabled: false,
      bounds: { x: 10, y: 10, width: 100, height: 40 },
    },
    {
      id: "password",
      tag: "input",
      role: "textbox",
      name: "Password",
      disabled: false,
      inputType: "password",
      bounds: { x: 10, y: 60, width: 200, height: 40 },
    },
  ],
};

function toolCall(id: string, name: string, args: Record<string, unknown>): ToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function approvalEvent(events: AgentEvent[]): AgentApprovalEvent {
  const event = events.find((candidate) => candidate.type === "AGENT_APPROVAL_REQUIRED");
  if (event?.type !== "AGENT_APPROVAL_REQUIRED") throw new Error("Expected approval event.");
  return event;
}

describe("AgentToolExecutor run approval", () => {
  it("prompts once and auto-approves later confirm actions in the same run", async () => {
    const approvals = new ApprovalManager();
    const events: AgentEvent[] = [];
    const executeAction = vi.fn(() => Promise.resolve({ message: "Executed." }));
    const executor = new AgentToolExecutor(
      { executeAction },
      new SafetyPolicy(),
      approvals,
      (event) => events.push(event),
    );
    const signal = new AbortController().signal;
    const click = toolCall("click", "click_element", { generation: 1, elementId: "submit" });
    const enter = toolCall("enter", "press_key", { key: "Enter" });

    const first = executor.execute(click, snapshot, "run-1", signal);
    const approval = approvalEvent(events);
    expect(approval.payload.detail).toContain("후속 승인 대상 동작도 함께 허용");
    expect(approvals.decide("run-1", approval.payload.approvalId, true)).toBe(true);
    await expect(first).resolves.toMatchObject({ failed: false });
    await expect(executor.execute(enter, snapshot, "run-1", signal)).resolves.toMatchObject({
      failed: false,
    });

    expect(events.filter((event) => event.type === "AGENT_APPROVAL_REQUIRED")).toHaveLength(1);
    expect(executeAction).toHaveBeenCalledTimes(2);
    expect(executeAction).toHaveBeenNthCalledWith(
      1,
      {
        type: "PAGE_CLICK",
        payload: {
          generation: 1,
          elementId: "submit",
          expected: snapshot.elements[0],
        },
      },
      "run-1",
      signal,
    );
  });

  it("keeps deny rules active after the run is approved", async () => {
    const approvals = new ApprovalManager();
    const events: AgentEvent[] = [];
    const executeAction = vi.fn(() => Promise.resolve({ message: "Executed." }));
    const executor = new AgentToolExecutor(
      { executeAction },
      new SafetyPolicy(),
      approvals,
      (event) => events.push(event),
    );
    const signal = new AbortController().signal;
    const click = toolCall("click", "click_element", { generation: 1, elementId: "submit" });
    const password = toolCall("password", "type_text", {
      generation: 1,
      elementId: "password",
      text: "secret",
      replace: true,
    });

    const first = executor.execute(click, snapshot, "run-1", signal);
    const approval = approvalEvent(events);
    approvals.decide("run-1", approval.payload.approvalId, true);
    await first;
    const denied = await executor.execute(password, snapshot, "run-1", signal);

    expect(denied.failed).toBe(true);
    expect(denied.message.content).toContain("Sensitive credential");
    expect(executeAction).toHaveBeenCalledTimes(1);
  });
});

describe("YouTube control tool guidance", () => {
  it("directs every requested player state change to a dedicated tool call", () => {
    const description = AGENT_TOOLS.find((tool) => tool.function.name === "youtube_control")
      ?.function.description;

    expect(description).toContain("pause, seek, playback rate, and volume");
    expect(description).toContain("one call for each requested state change");
    expect(description).toContain("Do not click visible player controls");
  });
});
