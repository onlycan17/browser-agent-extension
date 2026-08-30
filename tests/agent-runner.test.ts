import { describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../src/shared/agent";
import type { RequestAttachment } from "../src/shared/attachments";
import type { ChatRequest, ToolCall } from "../src/shared/llm";
import type { PageSnapshot } from "../src/shared/page";
import {
  AGENT_EMERGENCY_STEP_LIMIT,
  AGENT_RUN_TIMEOUT_MS,
  AgentRunner,
  MAX_PROVIDER_RETRIES,
  PROVIDER_RETRY_BASE_DELAY_MS,
} from "../src/background/agent-runner";
import { ApprovalManager } from "../src/background/approval-manager";
import type { AgentMemoryService, MemoryNote } from "../src/background/agent-memory-service";
import { ProviderError } from "../src/background/provider-http";
import type { AgentSkillService } from "../src/background/skill-service";
import { DEFAULT_LOCAL_MODEL, LOCAL_BASE_URL } from "../src/shared/settings";

function skillCatalog() {
  return {
    catalog: () =>
      Promise.resolve([
        {
          name: "youtube",
          description: "YouTube video guidance.",
          keywords: ["youtube"],
          urls: [],
          content: "Start playback before opening the transcript.",
          path: "skills/builtin/youtube/SKILL.md",
        },
        {
          name: "github",
          description: "GitHub repo guidance.",
          keywords: [],
          urls: ["github.com"],
          content: "Use canonical URLs.",
          path: "skills/builtin/site-specific/github/SKILL.md",
        },
      ]),
    content: (name: string) =>
      Promise.resolve(
        name === "youtube"
          ? {
              name: "youtube",
              description: "YouTube video guidance.",
              keywords: ["youtube"],
              urls: [],
              content: "Start playback before opening the transcript.",
              path: "skills/builtin/youtube/SKILL.md",
            }
          : null,
      ),
    autoInjectSkills: (pageUrl: string, instruction: string) =>
      Promise.resolve(
        pageUrl.includes("youtube") || instruction.toLowerCase().includes("youtube")
          ? [
              {
                name: "youtube",
                description: "YouTube video guidance.",
                keywords: ["youtube"],
                urls: [],
                content: "Start playback before opening the transcript.",
                path: "skills/builtin/youtube/SKILL.md",
              },
            ]
          : [],
      ),
  } satisfies AgentSkillService;
}

const settings = {
  provider: "local" as const,
  baseUrl: LOCAL_BASE_URL,
  model: DEFAULT_LOCAL_MODEL,
  rememberApiKey: false,
};
const anthropicSettings = {
  provider: "anthropic" as const,
  baseUrl: "https://api.anthropic.com",
  model: "claude-sonnet-4-20250514",
  apiKey: "test-key",
  rememberApiKey: false,
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
const captureCall: ToolCall = {
  id: "call-capture",
  type: "function",
  function: { name: "capture_screen", arguments: "{}" },
};
const transcriptSummaryCall: ToolCall = {
  id: "call-transcript-summary",
  type: "function",
  function: {
    name: "summarize_video_transcript",
    arguments: '{"focus":"핵심 논지와 결론"}',
  },
};

function memoryService(loaded: MemoryNote[] = []) {
  const appended: { origin: string; note: MemoryNote }[] = [];
  return {
    appended,
    service: {
      load: () => Promise.resolve(loaded),
      append: (origin: string, note: MemoryNote) => {
        appended.push({ origin, note });
        return Promise.resolve();
      },
    } satisfies AgentMemoryService,
  };
}

function memoryCall(id: string): ToolCall {
  return {
    id,
    type: "function",
    function: {
      name: "save_memory",
      arguments: `{"note":"Reusable lesson ${id}","kind":"success"}`,
    },
  };
}

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
  it("clears a run approval grant when the run finishes", async () => {
    const approvals = new ApprovalManager();
    const pending = approvals.request("run-approved", "approval-1", 1000);
    approvals.decide("run-approved", "approval-1", true);
    await pending;
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      tabs(),
      { complete: () => Promise.resolve({ role: "assistant", content: "Finished" }) },
      successfulTool(),
      approvals,
      () => undefined,
    );

    await runner.run("run-approved", "Finish", false);

    expect(approvals.isRunApproved("run-approved")).toBe(false);
    expect(runner.decideApproval("run-approved", "approval-1", true)).toBe(false);
  });

  it("does not repeat a successful action whose page did not settle", async () => {
    let completions = 0;
    let executions = 0;
    const requests: ChatRequest[] = [];
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      tabs(),
      {
        complete: (_settings, request) => {
          completions += 1;
          requests.push({ ...request, messages: [...request.messages] });
          if (completions < 3) {
            return Promise.resolve({
              role: "assistant" as const,
              content: null,
              tool_calls: [{ ...clickCall, id: `click-${String(completions)}` }],
            });
          }
          return Promise.resolve({ role: "assistant" as const, content: "Click handled once" });
        },
      },
      {
        execute: (call) => {
          executions += 1;
          return Promise.resolve({
            message: { role: "tool" as const, tool_call_id: call.id, content: '{"ok":true}' },
            failed: false,
            signature: "click_element:1:target",
            pageSettled: false,
          });
        },
      },
      new ApprovalManager(),
      () => undefined,
    );

    const result = await runner.run("run-unsettled-once", "Click once", false);

    expect(result).toMatchObject({ status: "completed", answer: "Click handled once", steps: 3 });
    expect(executions).toBe(1);
    expect(JSON.stringify(requests[2]?.messages)).toContain(
      "This action already executed; page settlement was not confirmed",
    );
  });

  it("returns a direct answer without executing a browser tool", async () => {
    let executions = 0;
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      tabs(),
      { complete: () => Promise.resolve({ role: "assistant", content: "Direct answer" }) },
      {
        execute: (call) => {
          executions += 1;
          return successfulTool().execute(call);
        },
      },
      new ApprovalManager(),
      () => undefined,
    );

    const result = await runner.run("run-direct", "Explain this page", false);

    expect(result).toMatchObject({ status: "completed", answer: "Direct answer", steps: 1 });
    expect(executions).toBe(0);
  });

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

  it("guides bounded transcript discovery for video analysis", async () => {
    let requestBody: ChatRequest | undefined;
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      tabs(),
      {
        complete: (_settings, request) => {
          requestBody = request;
          return Promise.resolve({ role: "assistant", content: "Finished" });
        },
      },
      successfulTool(),
      new ApprovalManager(),
      () => undefined,
    );

    await runner.run("run-transcript-guidance", "Analyze the full video", false);

    const systemMessage = requestBody?.messages[0];
    expect(systemMessage).toMatchObject({ role: "system" });
    const systemPrompt = systemMessage?.role === "system" ? systemMessage.content : "";
    expect(systemPrompt).toContain("unified browser assistant");
    expect(systemPrompt).toContain("do not use tools when");
    expect(systemPrompt).toContain("Use capture_screen only when visual evidence is necessary");
    expect(systemPrompt).toContain("<video_transcript_guidance>");
    expect(systemPrompt).toContain("use a full transcript already present");
    expect(systemPrompt).toContain("Show transcript may appear directly in the video description");
    expect(systemPrompt).toContain("More (더보기) > Show transcript (스크립트 표시)");
    expect(systemPrompt).toContain("prefer exact observed controls");
    expect(systemPrompt).not.toContain("right side of the video");
    expect(systemPrompt).toContain(
      "If the refreshed observation has no transcript control, stop discovery immediately",
    );
    expect(systemPrompt).toContain("exact observed element IDs");
    expect(systemPrompt).toContain("re-observe");
    expect(systemPrompt).toContain("at most two control actions");
    expect(systemPrompt).toContain("Do not guess selectors");
    expect(systemPrompt).toContain("summarize_video_transcript");
    expect(systemPrompt).toContain("Do not manually scroll through a long transcript");
    expect(systemPrompt).not.toContain("or Captions");
    expect(JSON.stringify(requestBody?.messages.slice(1))).not.toContain(
      "<video_transcript_guidance>",
    );
  });

  it("returns a hierarchical transcript summary to the main agent without page actions", async () => {
    const requests: ChatRequest[] = [];
    const events: AgentEvent[] = [];
    let completion = 0;
    const execute = vi.fn(successfulTool().execute);
    const summarize = vi.fn(() =>
      Promise.resolve({
        summary: "[00:00–42:00] 전체 영상 요약",
        chunks: 6,
        startTime: "00:00",
        endTime: "42:00",
        truncated: false,
      }),
    );
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      tabs(),
      {
        complete: (_settings, request) => {
          requests.push(request);
          completion += 1;
          return Promise.resolve(
            completion === 1
              ? { role: "assistant" as const, content: null, tool_calls: [transcriptSummaryCall] }
              : { role: "assistant" as const, content: "사용자에게 전달할 최종 요약" },
          );
        },
      },
      { execute },
      new ApprovalManager(),
      (event) => events.push(event),
      { summarize },
    );

    const result = await runner.run("run-long-transcript", "긴 영상 전체를 정리해줘", false);

    expect(result).toMatchObject({ status: "completed", answer: "사용자에게 전달할 최종 요약" });
    expect(summarize).toHaveBeenCalledWith(
      settings,
      "run-long-transcript",
      "핵심 논지와 결론",
      expect.any(AbortSignal),
      expect.any(Function),
    );
    expect(execute).not.toHaveBeenCalled();
    expect(JSON.stringify(requests[1]?.messages)).toContain("전체 영상 요약");
    expect(
      events.some(
        (event) => event.type === "AGENT_PROGRESS" && event.payload.code === "TRANSCRIPT",
      ),
    ).toBe(true);
  });

  it("includes attachments without granting autonomous screenshot access", async () => {
    let requestBody: ChatRequest | undefined;
    const attachments: RequestAttachment[] = [
      {
        kind: "text",
        name: "notes.txt",
        mediaType: "text/plain",
        text: "Agent attachment",
        size: 16,
        truncated: false,
      },
      {
        kind: "image",
        name: "reference.png",
        mediaType: "image/png",
        dataUrl: "data:image/png;base64,YWJj",
        size: 3,
      },
    ];
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      tabs(),
      {
        complete: (_settings, request) => {
          requestBody = request;
          return Promise.resolve({ role: "assistant", content: "Attachments read" });
        },
      },
      successfulTool(),
      new ApprovalManager(),
      () => undefined,
    );

    await runner.run("run-attachments", "Read the files", false, attachments);

    const serialized = JSON.stringify(requestBody);
    expect(serialized).toContain("Agent attachment");
    expect(serialized).toContain("data:image/png;base64,YWJj");
    expect(requestBody?.tools?.map((tool) => tool.function.name)).not.toContain("capture_screen");
  });

  it.each([
    { allowScreenshots: false, expected: false },
    { allowScreenshots: true, expected: true },
  ])(
    "sets capture_screen availability to $expected when screenshot permission is $allowScreenshots",
    async ({ allowScreenshots, expected }) => {
      let requestBody: ChatRequest | undefined;
      let captures = 0;
      const runner = new AgentRunner(
        { loadRuntime: () => Promise.resolve(settings) },
        {
          ...tabs(),
          captureActivePage: () => {
            captures += 1;
            return Promise.resolve("data:image/png;base64,abc");
          },
        },
        {
          complete: (_settings, request) => {
            requestBody = request;
            return Promise.resolve({ role: "assistant", content: "Finished" });
          },
        },
        successfulTool(),
        new ApprovalManager(),
        () => undefined,
      );

      await runner.run("run-capture-capability", "Inspect visually", allowScreenshots);

      const names = requestBody?.tools?.map((tool) => tool.function.name) ?? [];
      expect(names.includes("capture_screen")).toBe(expected);
      expect(captures).toBe(0);
    },
  );

  it("captures a fresh screen and defers later calls until the model sees it", async () => {
    let completions = 0;
    let captures = 0;
    let executions = 0;
    const requests: ChatRequest[] = [];
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      {
        ...tabs(),
        observeActivePage: () =>
          Promise.resolve({
            ...snapshot,
            url: "https://example.com/private?token=secret#fragment",
            visibleText: "Visible checkout summary",
          }),
        captureActivePage: () => {
          captures += 1;
          return Promise.resolve(`data:image/png;base64,capture${String(captures)}`);
        },
      },
      {
        complete: (_settings, request) => {
          completions += 1;
          requests.push({ ...request, messages: [...request.messages] });
          return Promise.resolve(
            completions === 1
              ? {
                  role: "assistant" as const,
                  content: null,
                  tool_calls: [captureCall, scrollCall],
                }
              : { role: "assistant" as const, content: "Visual inspection finished" },
          );
        },
      },
      {
        execute: (call) => {
          executions += 1;
          return successfulTool().execute(call);
        },
      },
      new ApprovalManager(),
      () => undefined,
    );

    const result = await runner.run("run-fresh-capture", "Inspect after changes", true);

    expect(result).toMatchObject({ status: "completed", answer: "Visual inspection finished" });
    expect(captures).toBe(1);
    expect(executions).toBe(0);
    const visionMessage = requests[1]?.messages.find(
      (message) =>
        message.role === "user" &&
        Array.isArray(message.content) &&
        message.content.some((part) => part.type === "image_url"),
    );
    const visionContent = visionMessage?.role === "user" ? visionMessage.content : null;
    expect(Array.isArray(visionContent)).toBe(true);
    if (!Array.isArray(visionContent)) {
      throw new Error("Expected multimodal user content");
    }
    const textPart = visionContent.find((part) => part.type === "text");
    const imagePart = visionContent.find((part) => part.type === "image_url");
    expect(textPart?.type === "text" ? textPart.text : "").toContain(
      "Structured page observation paired",
    );
    expect(imagePart?.type === "image_url" ? imagePart.image_url.url : "").toBe(
      "data:image/png;base64,capture1",
    );
    expect(JSON.stringify(visionMessage)).toContain("Visible checkout summary");
    expect(JSON.stringify(visionMessage)).toContain('\\"url\\":\\"https://example.com\\"');
    expect(JSON.stringify(visionMessage)).not.toContain("secret");
    expect(JSON.stringify(visionMessage)).not.toContain("fragment");
    expect(JSON.stringify(requests[1]?.messages)).toContain(
      "Deferred until a fresh page observation.",
    );
  });

  it("defers capture after an earlier action until a fresh observation", async () => {
    let completions = 0;
    let observations = 0;
    let captures = 0;
    let executions = 0;
    const requests: ChatRequest[] = [];
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      {
        ...tabs(),
        observeActivePage: () => {
          observations += 1;
          return Promise.resolve({
            ...snapshot,
            visibleText: observations === 1 ? "Before scroll" : "After scroll",
          });
        },
        captureActivePage: () => {
          captures += 1;
          return Promise.resolve("data:image/png;base64,after-scroll");
        },
      },
      {
        complete: (_settings, request) => {
          completions += 1;
          requests.push({ ...request, messages: [...request.messages] });
          if (completions === 1) {
            return Promise.resolve({
              role: "assistant" as const,
              content: null,
              tool_calls: [scrollCall, captureCall],
            });
          }
          if (completions === 2) {
            return Promise.resolve({
              role: "assistant" as const,
              content: null,
              tool_calls: [{ ...captureCall, id: "capture-after-observe" }],
            });
          }
          return Promise.resolve({ role: "assistant" as const, content: "Inspection finished" });
        },
      },
      {
        execute: (call) => {
          executions += 1;
          return successfulTool().execute(call);
        },
      },
      new ApprovalManager(),
      () => undefined,
    );

    const result = await runner.run("run-action-before-capture", "Scroll then inspect", true);

    expect(result).toMatchObject({ status: "completed", answer: "Inspection finished", steps: 3 });
    expect(executions).toBe(1);
    expect(captures).toBe(1);
    expect(JSON.stringify(requests[1]?.messages)).toContain(
      "Deferred until a fresh page observation.",
    );
    const pairedMessage = requests[2]?.messages.find(
      (message) =>
        message.role === "user" &&
        Array.isArray(message.content) &&
        message.content.some((part) => part.type === "image_url"),
    );
    const pairedContent = JSON.stringify(pairedMessage);
    expect(pairedContent).toContain("Structured page observation paired");
    expect(pairedContent).toContain("After scroll");
    expect(pairedContent).not.toContain("Before scroll");
  });

  it("retries capture_screen after a transient capture failure", async () => {
    let completions = 0;
    let captures = 0;
    const requests: ChatRequest[] = [];
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      {
        ...tabs(),
        captureActivePage: () => {
          captures += 1;
          if (captures === 1) return Promise.reject(new Error("transient capture failure"));
          return Promise.resolve(`data:image/png;base64,capture${String(captures)}`);
        },
      },
      {
        complete: (_settings, request) => {
          completions += 1;
          requests.push({ ...request, messages: [...request.messages] });
          if (completions === 3) {
            return Promise.resolve({ role: "assistant" as const, content: "Capture recovered" });
          }
          return Promise.resolve({
            role: "assistant" as const,
            content: null,
            tool_calls: [{ ...captureCall, id: `capture-${String(completions)}` }],
          });
        },
      },
      successfulTool(),
      new ApprovalManager(),
      () => undefined,
    );

    const result = await runner.run("run-capture-retry", "Retry a fresh capture", true);

    expect(result).toMatchObject({ status: "completed", answer: "Capture recovered", steps: 3 });
    expect(captures).toBe(2);
    expect(JSON.stringify(requests[1]?.messages)).toContain("The screen capture failed.");
    expect(JSON.stringify(requests[2]?.messages)).toContain(
      "Structured page observation paired with the fresh screen capture",
    );
    expect(JSON.stringify(requests[2]?.messages)).not.toContain(
      "This failed action will not be repeated.",
    );
  });

  it("enforces the six-capture on-demand run budget", async () => {
    let completions = 0;
    let captures = 0;
    let observations = 0;
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      {
        ...tabs(),
        observeActivePage: () => {
          observations += 1;
          return Promise.resolve({
            ...snapshot,
            visibleText: `state-${String.fromCharCode(64 + observations)}`,
          });
        },
        captureActivePage: () => {
          captures += 1;
          return Promise.resolve(`data:image/png;base64,capture${String(captures)}`);
        },
      },
      {
        complete: () => {
          completions += 1;
          if (completions === 7) {
            return Promise.resolve({
              role: "assistant" as const,
              content: "Capture budget respected",
            });
          }
          return Promise.resolve({
            role: "assistant" as const,
            content: null,
            tool_calls: [{ ...captureCall, id: `capture-${String(completions)}` }],
          });
        },
      },
      successfulTool(),
      new ApprovalManager(),
      () => undefined,
    );

    const result = await runner.run("run-capture-budget", "Inspect several views", true);

    expect(result).toMatchObject({
      status: "completed",
      answer: "Capture budget respected",
      steps: 7,
    });
    expect(captures).toBe(6);
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
    expect(events.some((event) => event.type === "AGENT_FINISHED")).toBe(false);
  });

  it("recovers a blank Local response and disables reasoning token usage", async () => {
    const requests: ChatRequest[] = [];
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      tabs(),
      {
        complete: (_settings, request) => {
          requests.push({ ...request, messages: [...request.messages] });
          return Promise.resolve(
            requests.length === 1
              ? { role: "assistant" as const, content: "   " }
              : { role: "assistant" as const, content: "Video analysis finished" },
          );
        },
      },
      successfulTool(),
      new ApprovalManager(),
      () => undefined,
    );

    const result = await runner.run("run-empty-local", "Analyze the video", false);

    expect(result).toMatchObject({
      status: "completed",
      answer: "Video analysis finished",
      steps: 2,
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]?.reasoningEffort).toBe("none");
    expect(requests[1]?.messages.at(-1)).toMatchObject({ role: "user" });
    expect(JSON.stringify(requests[1]?.messages)).toContain("previous response was empty");
  });

  it("recovers an empty tool-call array without replaying an invalid assistant turn", async () => {
    const requests: ChatRequest[] = [];
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(anthropicSettings) },
      tabs(),
      {
        complete: (_settings, request) => {
          requests.push({ ...request, messages: [...request.messages] });
          return Promise.resolve(
            requests.length === 1
              ? { role: "assistant" as const, content: null, tool_calls: [] }
              : { role: "assistant" as const, content: "Recovered safely" },
          );
        },
      },
      successfulTool(),
      new ApprovalManager(),
      () => undefined,
    );

    const result = await runner.run("run-empty-tools", "Complete the task", false);

    expect(result).toMatchObject({ status: "completed", answer: "Recovered safely", steps: 2 });
    expect(requests[0]?.reasoningEffort).toBeUndefined();
    expect(requests[1]?.messages).not.toContainEqual({
      role: "assistant",
      content: null,
      tool_calls: [],
    });
  });

  it("allows two consecutive empty-response retries before a final answer", async () => {
    let completions = 0;
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      tabs(),
      {
        complete: () => {
          completions += 1;
          return Promise.resolve(
            completions < 3
              ? { role: "assistant" as const, content: null, tool_calls: [] }
              : { role: "assistant" as const, content: "Recovered on the last retry" },
          );
        },
      },
      successfulTool(),
      new ApprovalManager(),
      () => undefined,
    );

    const result = await runner.run("run-empty-boundary", "Complete the task", false);

    expect(result).toMatchObject({
      status: "completed",
      answer: "Recovered on the last retry",
      steps: 3,
    });
  });

  it("resets the empty-response retry counter after a tool call", async () => {
    let completions = 0;
    let executions = 0;
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      tabs(),
      {
        complete: () => {
          completions += 1;
          if (completions === 2) {
            return Promise.resolve({
              role: "assistant" as const,
              content: null,
              tool_calls: [scrollCall],
            });
          }
          if (completions === 4) {
            return Promise.resolve({ role: "assistant" as const, content: "Finished after reset" });
          }
          return Promise.resolve({ role: "assistant" as const, content: null, tool_calls: [] });
        },
      },
      {
        execute: (call) => {
          executions += 1;
          return successfulTool().execute(call);
        },
      },
      new ApprovalManager(),
      () => undefined,
    );

    const result = await runner.run("run-empty-reset", "Complete the task", false);

    expect(result).toMatchObject({ status: "completed", answer: "Finished after reset", steps: 4 });
    expect(executions).toBe(1);
  });

  it("fails with a protocol error after two empty-response retries", async () => {
    let completions = 0;
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      tabs(),
      {
        complete: () => {
          completions += 1;
          return Promise.resolve({ role: "assistant", content: null, tool_calls: [] });
        },
      },
      successfulTool(),
      new ApprovalManager(),
      () => undefined,
    );

    await expect(runner.run("run-empty-limit", "Complete the task", false)).rejects.toMatchObject({
      code: "MODEL_PROTOCOL_ERROR",
      retryable: false,
    });
    expect(completions).toBe(3);
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

  it("continues beyond the legacy step cap while the page keeps changing", async () => {
    let completion = 0;
    let observation = 0;
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      {
        ...tabs(),
        observeActivePage: () => {
          observation += 1;
          return Promise.resolve({
            ...snapshot,
            visibleText: "Progress ".concat("x".repeat(observation)),
          });
        },
      },
      {
        complete: () => {
          completion += 1;
          if (completion === 14) {
            return Promise.resolve({ role: "assistant" as const, content: "Long task finished" });
          }
          const call: ToolCall = {
            id: `call-${String(completion)}`,
            type: "function",
            function: {
              name: "scroll_page",
              arguments: JSON.stringify({ direction: "down", amount: completion }),
            },
          };
          return Promise.resolve({ role: "assistant" as const, content: null, tool_calls: [call] });
        },
      },
      successfulTool(),
      new ApprovalManager(),
      () => undefined,
    );

    const result = await runner.run("run-long", "Finish a long task", false);

    expect(result).toMatchObject({ status: "completed", answer: "Long task finished", steps: 14 });
  });

  it("re-plans once when an action repeats without changing the page", async () => {
    let completions = 0;
    const requests: ChatRequest[] = [];
    const events: AgentEvent[] = [];
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      tabs(),
      {
        complete: (_settings, request) => {
          completions += 1;
          requests.push({ ...request, messages: [...request.messages] });
          return Promise.resolve(
            completions < 3
              ? { role: "assistant" as const, content: null, tool_calls: [scrollCall] }
              : { role: "assistant" as const, content: "Recovered with a new approach" },
          );
        },
      },
      successfulTool(),
      new ApprovalManager(),
      (event) => events.push(event),
    );

    const result = await runner.run("run-replan", "Find another way", true);

    expect(result).toMatchObject({
      status: "completed",
      answer: "Recovered with a new approach",
      steps: 3,
    });
    expect(JSON.stringify(requests[2]?.messages)).toContain("Re-plan once");
    expect(
      events.filter((event) => event.type === "AGENT_PROGRESS" && event.payload.code === "REPLAN"),
    ).toHaveLength(1);
  });

  it("stops when the same action produces the same page three times", async () => {
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      tabs(),
      {
        complete: () =>
          Promise.resolve({ role: "assistant", content: null, tool_calls: [scrollCall] }),
      },
      successfulTool(),
      new ApprovalManager(),
      () => undefined,
    );

    const result = await runner.run("run-stalled", "Keep scrolling", false);

    expect(result).toMatchObject({ status: "safety_limit", steps: 3 });
    expect(result.answer).toContain("did not change the page");
  });

  it("stops alternating ineffective actions when the page never changes", async () => {
    let completion = 0;
    const events: AgentEvent[] = [];
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      tabs(),
      {
        complete: () => {
          completion += 1;
          const call: ToolCall = {
            id: `alternating-${String(completion)}`,
            type: "function",
            function: {
              name: "scroll_page",
              arguments: JSON.stringify({
                direction: completion % 2 === 0 ? "up" : "down",
                amount: 500,
              }),
            },
          };
          return Promise.resolve({ role: "assistant" as const, content: null, tool_calls: [call] });
        },
      },
      successfulTool(),
      new ApprovalManager(),
      (event) => events.push(event),
    );

    const result = await runner.run("run-alternating-stall", "Find another route", false);

    expect(result).toMatchObject({ status: "safety_limit", steps: 3 });
    expect(
      events.filter((event) => event.type === "AGENT_PROGRESS" && event.payload.code === "REPLAN"),
    ).toHaveLength(1);
  });

  it("does not treat different text input as the same stalled action", async () => {
    let completion = 0;
    const textValues = ["one", "two", "six"];
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      tabs(),
      {
        complete: () => {
          const text = textValues[completion];
          completion += 1;
          if (text === undefined) {
            return Promise.resolve({ role: "assistant" as const, content: "Input finished" });
          }
          const call: ToolCall = {
            id: `type-${String(completion)}`,
            type: "function",
            function: {
              name: "type_text",
              arguments: JSON.stringify({
                generation: 1,
                elementId: "query",
                text,
                replace: true,
              }),
            },
          };
          return Promise.resolve({ role: "assistant" as const, content: null, tool_calls: [call] });
        },
      },
      successfulTool(),
      new ApprovalManager(),
      () => undefined,
    );

    const result = await runner.run("run-text", "Refine a query", false);

    expect(result).toMatchObject({ status: "completed", answer: "Input finished", steps: 4 });
  });

  it("detects a stall despite volatile page text, bounds, and playback time", async () => {
    let observation = 0;
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      {
        ...tabs(),
        observeActivePage: () => {
          observation += 1;
          return Promise.resolve({
            ...snapshot,
            visibleText: `Clock ${String(observation)}`,
            elements: [
              {
                id: "status",
                tag: "div",
                role: "status",
                name: "Live status",
                disabled: false,
                bounds: { x: observation, y: 0, width: 100, height: 20 },
              },
            ],
            youtube: {
              title: "Live video",
              currentTime: observation,
              duration: 120,
              durationKnown: true,
              isLive: false,
              paused: false,
              playbackRate: 1,
              volume: 1,
              captionText: `Caption ${String(observation)}`,
            },
          });
        },
      },
      {
        complete: () =>
          Promise.resolve({ role: "assistant", content: null, tool_calls: [scrollCall] }),
      },
      successfulTool(),
      new ApprovalManager(),
      () => undefined,
    );

    const result = await runner.run("run-dynamic-stall", "Keep scrolling", false);

    expect(result).toMatchObject({ status: "safety_limit", steps: 3 });
  });

  it("stops at the emergency step watchdog while the page keeps changing", async () => {
    let completion = 0;
    let observation = 0;
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      {
        ...tabs(),
        observeActivePage: () => {
          observation += 1;
          return Promise.resolve({
            ...snapshot,
            visibleText: "Progress ".concat("x".repeat(observation)),
          });
        },
      },
      {
        complete: () => {
          completion += 1;
          const call: ToolCall = {
            id: `call-${String(completion)}`,
            type: "function",
            function: {
              name: "scroll_page",
              arguments: JSON.stringify({ direction: "down", amount: completion }),
            },
          };
          return Promise.resolve({ role: "assistant" as const, content: null, tool_calls: [call] });
        },
      },
      successfulTool(),
      new ApprovalManager(),
      () => undefined,
    );

    const result = await runner.run("run-watchdog", "Never finish", false);

    expect(result).toMatchObject({ status: "safety_limit", steps: AGENT_EMERGENCY_STEP_LIMIT });
    expect(completion).toBe(AGENT_EMERGENCY_STEP_LIMIT);
  });

  it("cancels an in-flight tool wait immediately", async () => {
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      tabs(),
      {
        complete: () =>
          Promise.resolve({ role: "assistant", content: null, tool_calls: [scrollCall] }),
      },
      {
        execute: () => {
          markStarted?.();
          return new Promise(() => undefined);
        },
      },
      new ApprovalManager(),
      () => undefined,
    );

    const running = runner.run("run-cancel-action", "Keep working", false);
    await started;
    runner.cancel("run-cancel-action");

    await expect(running).resolves.toMatchObject({ status: "cancelled", steps: 1 });
  });

  it("aborts an in-flight model call at the elapsed-time watchdog", async () => {
    vi.useFakeTimers();
    try {
      const approvals = new ApprovalManager();
      const approval = approvals.request(
        "run-hard-timeout",
        "approval-1",
        AGENT_RUN_TIMEOUT_MS * 2,
      );
      approvals.decide("run-hard-timeout", "approval-1", true);
      await approval;
      let markStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const runner = new AgentRunner(
        { loadRuntime: () => Promise.resolve(settings) },
        tabs(),
        {
          complete: () => {
            markStarted?.();
            return new Promise(() => undefined);
          },
        },
        successfulTool(),
        approvals,
        () => undefined,
      );

      const running = runner.run("run-hard-timeout", "Never respond", false);
      await started;
      await vi.advanceTimersByTimeAsync(AGENT_RUN_TIMEOUT_MS);

      await expect(running).resolves.toMatchObject({ status: "safety_limit", steps: 1 });
      expect(approvals.isRunApproved("run-hard-timeout")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops at the elapsed-time watchdog", async () => {
    let elapsed = 0;
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      tabs(),
      {
        complete: () =>
          Promise.resolve({ role: "assistant", content: null, tool_calls: [scrollCall] }),
      },
      {
        execute: (call) => {
          elapsed = AGENT_RUN_TIMEOUT_MS;
          return successfulTool().execute(call);
        },
      },
      new ApprovalManager(),
      () => undefined,
      undefined,
      undefined,
      () => elapsed,
    );

    const result = await runner.run("run-timeout", "Keep working", false);

    expect(result).toMatchObject({ status: "safety_limit", steps: 1 });
    expect(result.answer).toContain("30-minute safety limit");
  });

  it("accepts an explicit plan and injects tracked progress into later observations", async () => {
    const requests: ChatRequest[] = [];
    const events: AgentEvent[] = [];
    let completions = 0;
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      tabs(),
      {
        complete: (_settings, request) => {
          completions += 1;
          requests.push({ ...request, messages: [...request.messages] });
          if (completions === 1) {
            return Promise.resolve({
              role: "assistant" as const,
              content: null,
              tool_calls: [
                {
                  id: "call-plan",
                  type: "function",
                  function: {
                    name: "create_plan",
                    arguments: '{"steps":["Open settings","Save the form"]}',
                  },
                },
              ],
            });
          }
          if (completions === 2) {
            return Promise.resolve({
              role: "assistant" as const,
              content: null,
              tool_calls: [
                {
                  id: "call-progress",
                  type: "function",
                  function: {
                    name: "update_plan",
                    arguments: '{"completedSteps":1,"currentStep":"Save the form"}',
                  },
                },
              ],
            });
          }
          return Promise.resolve({ role: "assistant" as const, content: "Plan finished" });
        },
      },
      successfulTool(),
      new ApprovalManager(),
      (event) => events.push(event),
    );

    const result = await runner.run("run-planner", "Do it step by step", false);

    expect(result).toMatchObject({ status: "completed", answer: "Plan finished", steps: 3 });
    expect(JSON.stringify(requests[2]?.messages)).toContain("Active plan (tracked progress):");
    expect(JSON.stringify(requests[2]?.messages)).toContain("[done] Open settings");
    expect(JSON.stringify(requests[2]?.messages)).toContain("[in progress] Save the form");
    expect(
      events.filter((event) => event.type === "AGENT_PROGRESS" && event.payload.code === "PLAN")
        .length,
    ).toBe(2);
  });

  it("injects saved site memory and persists new notes only after a completed run", async () => {
    const memory = memoryService([
      { text: "The saved search is in the account menu.", kind: "success", savedAt: 1 },
    ]);
    const requests: ChatRequest[] = [];
    let completions = 0;
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      tabs(),
      {
        complete: (_settings, request) => {
          completions += 1;
          requests.push({ ...request, messages: [...request.messages] });
          if (completions === 1) {
            return Promise.resolve({
              role: "assistant" as const,
              content: null,
              tool_calls: [memoryCall("mem-1")],
            });
          }
          return Promise.resolve({ role: "assistant" as const, content: "All done" });
        },
      },
      successfulTool(),
      new ApprovalManager(),
      () => undefined,
      undefined,
      memory.service,
    );

    const result = await runner.run("run-memory", "Repeat the task", false);

    expect(result).toMatchObject({ status: "completed", answer: "All done" });
    const initial = JSON.stringify(requests[0]?.messages);
    expect(initial).toContain("Local task memory for this site");
    expect(initial).toContain("The saved search is in the account menu.");
    expect(memory.appended).toHaveLength(1);
    expect(memory.appended[0]).toMatchObject({
      origin: "https://example.com",
      note: { kind: "success", text: "Reusable lesson mem-1" },
    });
  });

  it("pauses for the user and resumes from a fresh observation after confirmation", async () => {
    const events: AgentEvent[] = [];
    const requests: ChatRequest[] = [];
    let completions = 0;
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      tabs(),
      {
        complete: (_settings, request) => {
          completions += 1;
          requests.push({ ...request, messages: [...request.messages] });
          if (completions === 1) {
            return Promise.resolve({
              role: "assistant" as const,
              content: null,
              tool_calls: [
                {
                  id: "call-pause",
                  type: "function",
                  function: {
                    name: "pause_for_user",
                    arguments: '{"reason":"Sign in to the site, then continue."}',
                  },
                },
              ],
            });
          }
          return Promise.resolve({ role: "assistant" as const, content: "Signed in and done" });
        },
      },
      successfulTool(),
      new ApprovalManager(),
      (event) => events.push(event),
    );

    const running = runner.run("run-pause", "Do the signed-in task", false);
    await vi.waitFor(() => {
      expect(events.some((event) => event.type === "AGENT_APPROVAL_REQUIRED")).toBe(true);
    });
    const approval = events.find(
      (event): event is Extract<AgentEvent, { type: "AGENT_APPROVAL_REQUIRED" }> =>
        event.type === "AGENT_APPROVAL_REQUIRED",
    );
    expect(approval?.payload.title).toBe("사용자 확인 필요");
    expect(approval?.payload.detail).toContain("Sign in to the site");

    expect(runner.decideApproval("run-pause", approval?.payload.approvalId ?? "", true)).toBe(true);
    const result = await running;

    expect(result).toMatchObject({ status: "completed", answer: "Signed in and done" });
    expect(JSON.stringify(requests[1]?.messages)).toContain(
      "The user completed the requested step",
    );
  });

  it("continues with a limitation note when the user denies the pause request", async () => {
    const events: AgentEvent[] = [];
    let completions = 0;
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      tabs(),
      {
        complete: () => {
          completions += 1;
          if (completions === 1) {
            return Promise.resolve({
              role: "assistant" as const,
              content: null,
              tool_calls: [
                {
                  id: "call-pause-deny",
                  type: "function",
                  function: {
                    name: "pause_for_user",
                    arguments: '{"reason":"Please solve the captcha."}',
                  },
                },
              ],
            });
          }
          return Promise.resolve({ role: "assistant" as const, content: "Stopped gracefully" });
        },
      },
      successfulTool(),
      new ApprovalManager(),
      (event) => events.push(event),
    );

    const running = runner.run("run-pause-deny", "Try the task", false);
    await vi.waitFor(() => {
      expect(events.some((event) => event.type === "AGENT_APPROVAL_REQUIRED")).toBe(true);
    });
    const approval = events.find(
      (event): event is Extract<AgentEvent, { type: "AGENT_APPROVAL_REQUIRED" }> =>
        event.type === "AGENT_APPROVAL_REQUIRED",
    );
    runner.decideApproval("run-pause-deny", approval?.payload.approvalId ?? "", false);

    const result = await running;

    expect(result).toMatchObject({ status: "completed", answer: "Stopped gracefully" });
  });

  it("retries retryable provider errors with backoff and completes", async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const events: AgentEvent[] = [];
      const runner = new AgentRunner(
        { loadRuntime: () => Promise.resolve(settings) },
        tabs(),
        {
          complete: () => {
            attempts += 1;
            if (attempts === 1) {
              return Promise.reject(
                new ProviderError("PROVIDER_REJECTED", "rate-limited upstream", true),
              );
            }
            return Promise.resolve({ role: "assistant" as const, content: "Recovered" });
          },
        },
        successfulTool(),
        new ApprovalManager(),
        (event) => events.push(event),
      );

      const running = runner.run("run-retry", "Try the task", false);
      await vi.advanceTimersByTimeAsync(PROVIDER_RETRY_BASE_DELAY_MS);
      const result = await running;

      expect(result).toMatchObject({ status: "completed", answer: "Recovered" });
      expect(attempts).toBe(2);
      expect(
        events.some((event) => event.type === "AGENT_PROGRESS" && event.payload.code === "RETRY"),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up after the provider retry budget", async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const runner = new AgentRunner(
        { loadRuntime: () => Promise.resolve(settings) },
        tabs(),
        {
          complete: () => {
            attempts += 1;
            return Promise.reject(
              new ProviderError("PROVIDER_REJECTED", "rate-limited upstream", true),
            );
          },
        },
        successfulTool(),
        new ApprovalManager(),
        () => undefined,
      );

      const running = runner.run("run-retry-budget", "Try the task", false);
      const settled = running.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(
        PROVIDER_RETRY_BASE_DELAY_MS * (2 ** MAX_PROVIDER_RETRIES - 1),
      );
      const failure = (await settled) as ProviderError;

      expect(failure).toBeInstanceOf(ProviderError);
      expect(failure).toMatchObject({
        code: "PROVIDER_REJECTED",
        message: "rate-limited upstream",
      });
      expect(attempts).toBe(MAX_PROVIDER_RETRIES + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry non-retryable provider errors", async () => {
    let attempts = 0;
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      tabs(),
      {
        complete: () => {
          attempts += 1;
          return Promise.reject(
            new ProviderError("MODEL_PROTOCOL_ERROR", "unsupported parameter", false),
          );
        },
      },
      successfulTool(),
      new ApprovalManager(),
      () => undefined,
    );

    await expect(runner.run("run-no-retry", "Try the task", false)).rejects.toMatchObject({
      code: "MODEL_PROTOCOL_ERROR",
    });
    expect(attempts).toBe(1);
  });

  it("lists the skill catalog, auto-injects matched skills, and serves load_skill", async () => {
    const requests: ChatRequest[] = [];
    let completions = 0;
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      tabs(),
      {
        complete: (_settings, request) => {
          completions += 1;
          requests.push({ ...request, messages: [...request.messages] });
          if (completions === 1) {
            return Promise.resolve({
              role: "assistant" as const,
              content: null,
              tool_calls: [
                {
                  id: "call-skill",
                  type: "function",
                  function: { name: "load_skill", arguments: '{"name":"youtube"}' },
                },
              ],
            });
          }
          if (completions === 2) {
            return Promise.resolve({
              role: "assistant" as const,
              content: null,
              tool_calls: [
                {
                  id: "call-skill-bad",
                  type: "function",
                  function: { name: "load_skill", arguments: '{"name":"nope"}' },
                },
              ],
            });
          }
          return Promise.resolve({ role: "assistant" as const, content: "Done with skills" });
        },
      },
      successfulTool(),
      new ApprovalManager(),
      () => undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      skillCatalog(),
    );

    const result = await runner.run("run-skill", "youtube 요약해줘", false);

    expect(result).toMatchObject({ status: "completed", answer: "Done with skills" });
    const initial = JSON.stringify(requests[0]?.messages);
    expect(initial).toContain("Bundled skill catalog");
    expect(initial).toContain("youtube: YouTube video guidance.");
    expect(initial).toContain("Start playback before opening the transcript.");
    expect(JSON.stringify(requests[1]?.messages)).toContain(
      "Start playback before opening the transcript.",
    );
    expect(JSON.stringify(requests[2]?.messages)).toContain("No bundled skill matches this name");
  });

  it("caps memory notes at three per run", async () => {
    const memory = memoryService();
    const requests: ChatRequest[] = [];
    let completions = 0;
    const runner = new AgentRunner(
      { loadRuntime: () => Promise.resolve(settings) },
      tabs(),
      {
        complete: (_settings, request) => {
          completions += 1;
          requests.push({ ...request, messages: [...request.messages] });
          if (completions === 1) {
            return Promise.resolve({
              role: "assistant" as const,
              content: null,
              tool_calls: [
                memoryCall("mem-1"),
                memoryCall("mem-2"),
                memoryCall("mem-3"),
                memoryCall("mem-4"),
              ],
            });
          }
          return Promise.resolve({ role: "assistant" as const, content: "Finished" });
        },
      },
      successfulTool(),
      new ApprovalManager(),
      () => undefined,
      undefined,
      memory.service,
    );

    await runner.run("run-memory-cap", "Collect lessons", false);

    expect(memory.appended).toHaveLength(3);
    expect(JSON.stringify(requests[1]?.messages)).toContain(
      "The memory note budget for this run is used up.",
    );
  });
});
