import { describe, expect, it, vi } from "vitest";
import type { AgentApprovalEvent, AgentEvent } from "../src/shared/agent";
import type { ToolCall } from "../src/shared/llm";
import type { PageSnapshot } from "../src/shared/page";
import { AGENT_TOOLS, AgentToolExecutor } from "../src/background/agent-tools";
import { ApprovalManager } from "../src/background/approval-manager";
import { SafetyPolicy } from "../src/background/safety-policy";
import { PageActionError } from "../src/background/tab-service";

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
    {
      id: "region",
      tag: "select",
      role: "combobox",
      name: "Region",
      disabled: false,
      bounds: { x: 10, y: 110, width: 200, height: 40 },
      options: [
        { label: "Seoul", selected: true, disabled: false },
        { label: "Busan", selected: false, disabled: false },
      ],
    },
    {
      id: "results",
      tag: "section",
      role: "section",
      name: "Results",
      disabled: false,
      bounds: { x: 10, y: 160, width: 300, height: 200 },
      scrollableY: true,
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

  it("offers guarded form and nested-scroll tools", () => {
    const tools = new Map(AGENT_TOOLS.map((tool) => [tool.function.name, tool]));

    expect(tools.get("select_option")?.function.parameters).toMatchObject({
      required: ["generation", "elementId", "optionLabel"],
      additionalProperties: false,
    });
    expect(tools.get("set_checked")?.function.parameters).toMatchObject({
      required: ["generation", "elementId", "checked"],
      additionalProperties: false,
    });
    expect(tools.get("scroll_element")?.function.parameters).toMatchObject({
      required: ["generation", "elementId", "direction", "amount"],
      additionalProperties: false,
    });
  });

  it("offers a dedicated hierarchical transcript summary tool", () => {
    const tool = AGENT_TOOLS.find(
      (candidate) => candidate.function.name === "summarize_video_transcript",
    );

    expect(tool?.function.description).toContain("opened transcript");
    expect(tool?.function.description).toContain("chunk");
    expect(tool?.function.parameters).toMatchObject({
      properties: { focus: { type: "string", maxLength: 500 } },
      additionalProperties: false,
    });
  });
});

describe("AgentToolExecutor action errors", () => {
  it("reports an unsettled successful action without replaying it", async () => {
    const approvals = new ApprovalManager();
    const seed = approvals.request("run-unsettled", "seed");
    approvals.decide("run-unsettled", "seed", true);
    await seed;
    const executeAction = vi.fn(() => Promise.resolve({ message: "Clicked.", pageSettled: false }));
    const executor = new AgentToolExecutor(
      { executeAction },
      new SafetyPolicy(),
      approvals,
      () => undefined,
    );

    const result = await executor.execute(
      toolCall("click", "click_element", { generation: 1, elementId: "submit" }),
      snapshot,
      "run-unsettled",
      new AbortController().signal,
    );

    expect(result.failed).toBe(false);
    expect(result.pageSettled).toBe(false);
    expect(JSON.parse(result.message.content)).toEqual({
      ok: true,
      message: "Clicked.",
      pageSettled: false,
    });
    expect(executeAction).toHaveBeenCalledTimes(1);
  });

  it("dispatches guarded select and nested-scroll requests", async () => {
    const approvals = new ApprovalManager();
    const seed = approvals.request("run-1", "seed");
    approvals.decide("run-1", "seed", true);
    await seed;
    const executeAction = vi.fn(() => Promise.resolve({ message: "Executed." }));
    const executor = new AgentToolExecutor(
      { executeAction },
      new SafetyPolicy(),
      approvals,
      () => undefined,
    );
    const signal = new AbortController().signal;

    await executor.execute(
      toolCall("select", "select_option", {
        generation: 1,
        elementId: "region",
        optionLabel: "Busan",
      }),
      snapshot,
      "run-1",
      signal,
    );
    await executor.execute(
      toolCall("scroll", "scroll_element", {
        generation: 1,
        elementId: "results",
        direction: "down",
        amount: 400,
      }),
      snapshot,
      "run-1",
      signal,
    );

    expect(executeAction).toHaveBeenNthCalledWith(
      1,
      {
        type: "PAGE_SELECT_OPTION",
        payload: {
          generation: 1,
          elementId: "region",
          optionLabel: "Busan",
          expected: snapshot.elements[2],
        },
      },
      "run-1",
      signal,
    );
    expect(executeAction).toHaveBeenNthCalledWith(
      2,
      {
        type: "PAGE_SCROLL_ELEMENT",
        payload: {
          generation: 1,
          elementId: "results",
          direction: "down",
          amount: 400,
          expected: snapshot.elements[3],
        },
      },
      "run-1",
      signal,
    );
  });

  it("returns a retryable structured stale-element result", async () => {
    const executor = new AgentToolExecutor(
      {
        executeAction: () =>
          Promise.reject(
            new PageActionError(
              "STALE_ELEMENT",
              "The target changed after observation; observe it again.",
              true,
            ),
          ),
      },
      new SafetyPolicy(),
      new ApprovalManager(),
      () => undefined,
    );
    const signal = new AbortController().signal;
    const call = toolCall("type", "type_text", {
      generation: 1,
      elementId: "submit",
      text: "hello",
      replace: true,
    });

    const result = await executor.execute(call, snapshot, "run-1", signal);

    expect(result).toMatchObject({ failed: true, retryableFailure: true });
    expect(JSON.parse(result.message.content)).toEqual({
      ok: false,
      code: "STALE_ELEMENT",
      error: "The target changed after observation; observe it again.",
      retryable: true,
    });
  });
});
