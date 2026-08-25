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
const clickCall: ToolCall = {
  id: "call-click",
  type: "function",
  function: { name: "click_element", arguments: '{"generation":1,"elementId":"target"}' },
};
const enterCall: ToolCall = {
  id: "call-enter",
  type: "function",
  function: { name: "press_key", arguments: '{"key":"Enter"}' },
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

  it.each([
    { label: "click", call: clickCall, actionFailed: false },
    { label: "Enter", call: enterCall, actionFailed: false },
    { label: "failed click", call: clickCall, actionFailed: true },
  ])("re-observes after $label before later calls", async ({ call, actionFailed }) => {
    let completion = 0;
    const executed: string[] = [];
    const requests: unknown[] = [];
    const sensitiveSnapshot = {
      ...snapshot,
      url: "https://example.com/reset/private-token?code=secret#fragment",
    };
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      {
        ...tabs(),
        observeActivePage: () => Promise.resolve(sensitiveSnapshot),
      },
      {
        complete: (_settings, request) => {
          completion += 1;
          requests.push(request);
          return Promise.resolve(
            completion === 1
              ? { role: "assistant" as const, content: null, tool_calls: [call, scrollCall] }
              : { role: "assistant" as const, content: "Finished safely" },
          );
        },
      },
      {
        execute: (call) => {
          executed.push(call.function.name);
          return successfulTool(actionFailed).execute(call);
        },
      },
      new ApprovalManager(),
      () => undefined,
    );

    const result = await runner.run("run-navigation", "Click and continue", false);

    const serializedRequests = JSON.stringify(requests);
    expect(result.answer).toBe("Finished safely");
    expect(executed).toEqual([call.function.name]);
    expect(serializedRequests).toContain("Deferred until a fresh page observation.");
    expect(serializedRequests).toContain('\\"url\\":\\"https://example.com\\"');
    expect(serializedRequests).not.toContain("private-token");
    expect(serializedRequests).not.toContain("code=secret");
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
