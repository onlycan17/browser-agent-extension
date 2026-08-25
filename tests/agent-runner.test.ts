import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/shared/agent";
import type { ToolCall } from "../src/shared/llm";
import type { PageSnapshot } from "../src/shared/page";
import { AgentRunner } from "../src/background/agent-runner";
import { ApprovalManager } from "../src/background/approval-manager";
import { DEFAULT_LOCAL_MODEL, LOCAL_BASE_URL } from "../src/shared/settings";

const settings = {
  provider: "local" as const,
  baseUrl: LOCAL_BASE_URL,
  model: DEFAULT_LOCAL_MODEL,
  rememberApiKey: false,
  maxAgentSteps: 4,
};
const snapshot: PageSnapshot = {
  generation: 1,
  url: "https://example.com/",
  title: "Example",
  viewport: { width: 1000, height: 800, scrollX: 0, scrollY: 0 },
  visibleText: "Example",
  elements: [],
};
const scrollCall: ToolCall = {
  id: "call-1",
  type: "function",
  function: { name: "scroll_page", arguments: '{"direction":"down","amount":500}' },
};

function tabs() {
  return {
    pinActivePage: () => Promise.resolve(),
    releasePinnedPage: () => undefined,
    observeActivePage: () => Promise.resolve(snapshot),
    captureActivePage: () => Promise.resolve("data:image/png;base64,abc"),
  };
}

function successfulTool(failed = false) {
  return {
    execute: (call: ToolCall) =>
      Promise.resolve({
        message: { role: "tool" as const, tool_call_id: call.id, content: '{"ok":true}' },
        failed,
        signature: "scroll_page:down:500",
      }),
  };
}

describe("AgentRunner", () => {
  it("honors cancellation received before run registration", async () => {
    let pinned = false;
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      {
        ...tabs(),
        pinActivePage: () => {
          pinned = true;
          return Promise.resolve();
        },
      },
      { complete: () => Promise.resolve({ role: "assistant", content: "must not run" }) },
      successfulTool(),
      new ApprovalManager(),
      () => undefined,
    );

    expect(runner.cancel("run-early")).toBe(true);
    const result = await runner.run("run-early", "Stop immediately", false);

    expect(result).toMatchObject({ runId: "run-early", status: "cancelled" });
    expect(pinned).toBe(false);
  });

  it("executes a tool round and returns the final answer", async () => {
    let completion = 0;
    const events: AgentEvent[] = [];
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      tabs(),
      {
        complete: () => {
          completion += 1;
          return Promise.resolve(
            completion === 1
              ? { role: "assistant" as const, content: null, tool_calls: [scrollCall] }
              : { role: "assistant" as const, content: "Finished" },
          );
        },
      },
      successfulTool(),
      new ApprovalManager(),
      (event) => events.push(event),
    );

    const result = await runner.run("run-1", "Scroll and finish", true);

    expect(result).toMatchObject({ status: "completed", answer: "Finished", steps: 2 });
    expect(completion).toBe(2);
    expect(events.some((event) => event.type === "AGENT_PROGRESS")).toBe(true);
    expect(events.at(-1)?.type).toBe("AGENT_FINISHED");
  });

  it("does not execute the same failed tool twice", async () => {
    let completion = 0;
    let executions = 0;
    const tools = successfulTool(true);
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      tabs(),
      {
        complete: () => {
          completion += 1;
          return Promise.resolve(
            completion < 3
              ? { role: "assistant" as const, content: null, tool_calls: [scrollCall] }
              : { role: "assistant" as const, content: "Stopped repeating" },
          );
        },
      },
      {
        execute: (call) => {
          executions += 1;
          return tools.execute(call);
        },
      },
      new ApprovalManager(),
      () => undefined,
    );

    const result = await runner.run("run-2", "Try once", false);

    expect(result.answer).toBe("Stopped repeating");
    expect(executions).toBe(1);
  });

  it("stops at the configured step limit", async () => {
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve({ ...settings, maxAgentSteps: 2 }) },
      tabs(),
      {
        complete: () =>
          Promise.resolve({ role: "assistant", content: null, tool_calls: [scrollCall] }),
      },
      successfulTool(),
      new ApprovalManager(),
      () => undefined,
    );

    const result = await runner.run("run-3", "Keep scrolling", false);

    expect(result).toMatchObject({ status: "step_limit", steps: 2 });
  });
});
