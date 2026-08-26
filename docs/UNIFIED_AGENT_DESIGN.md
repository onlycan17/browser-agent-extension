# Unified Adaptive Agent Design

Status: Implemented — automated and static Side Panel QA complete; real unpacked-Chrome/provider QA remains tracked separately.

## 1. Goal

Replace the separate `화면 분석` and `메시지 보내기` behaviors with one adaptive request flow. The user sends one message; the agent decides whether to answer from the current page, inspect attachments, form a short internal plan, execute safe browser tools, request a fresh screenshot, or explain a blocker.

The unified flow must preserve request-scoped screenshot consent, explicit approval for risky actions, cancellation, tab/origin pinning, attachment validation, Local Network Access guidance, MV3 heartbeat recovery, and all existing safety limits.

## 2. Product behavior

### One composer action

- Remove the standalone `화면 분석` button.
- Keep one primary submit button labeled `보내기`.
- Every submitted message starts the same agent lifecycle and can be stopped with the existing `중지` button.
- Initial UI copy is neutral: the agent is understanding the request, inspecting the current page, and deciding the next step.

### Adaptive request handling

The model receives the user instruction, attachments, and a fresh DOM observation. It follows this policy:

1. Determine whether the request is informational, analytical, or action-oriented.
2. Form a concise internal plan proportional to the request. Do not expose chain-of-thought.
3. If the current observation and attachments are sufficient, answer directly without a tool call.
4. If action is needed, use only the smallest safe sequence of provided tools.
5. If visual information is necessary, the DOM is insufficient, or progress is blocked, request `capture_screen` when the user enabled screenshot access.
6. After failed or deferred actions, inspect the fresh observation and choose a different safe approach instead of repeating the same action.
7. If the task cannot continue, explain the concrete limitation rather than pretending it succeeded.

A separate planning tool is intentionally excluded. Prompt-driven planning keeps Local-model compatibility and avoids forcing unnecessary tool calls for simple questions.

### Screenshot behavior

- `화면 캡처 허용` remains explicit and request-scoped.
- Enabling it exposes `capture_screen`; disabling it makes capture impossible.
- The unified flow does not capture automatically at request start.
- The model captures only when visual evidence is useful or DOM-based progress is blocked.
- Existing pinned-tab checks, Chrome rate guard, six-capture limit, cancellation, timeout, and fresh-image deferral remain unchanged.

This changes the previous capture contract, which included an initial screenshot whenever consent was enabled. On-demand capture reduces unnecessary page disclosure, model latency, and provider cost.

## 3. Bounded blocked recovery

The current runner stops after three identical page/action transitions. The unified runner adds one bounded recovery opportunity before final stall termination:

- On the second identical transition, append a re-planning instruction.
- The instruction tells the model to reassess the latest observation, avoid the repeated action, use `capture_screen` if visual context is both allowed and useful, or return a clear limitation.
- Mark the recovery as used so it can happen only once per run.
- If the same transition continues to the existing limit, terminate with `safety_limit` as today.

Tool failures remain visible to the model. Permanent failed-action signatures still prevent identical retries, while transient screenshot failures remain retryable.

## 4. Runtime and architecture migration

### Remove the parallel analysis path

Delete:

- `PAGE_ANALYZE_REQUEST` from `RequestPayloadMap`, `ResponseDataMap`, and runtime parsing
- `PageAnalysisResult` from `src/shared/page.ts`
- `PageAnalysisService` and `src/background/page-analysis-service.ts`
- `AnalysisService` injection and branch in `message-handler.ts`
- analysis service construction in `src/background/index.ts`
- Side Panel `analyzeButton`, `setAnalyzing()`, and `analyzePage()`
- `tests/page-analysis-service.test.ts` and analysis-only message fixtures

Retain `AGENT_RUN_REQUEST` as the single internal request contract. Renaming it would create churn without changing user-visible behavior.

### Preserve Local Network Access guidance

The old analysis path wrapped its provider call with `runProviderRequest()`, but the current agent-start path does not. The unified Side Panel must:

1. Load `SETTINGS_GET` before starting the run.
2. Wrap `startAgentWithRecovery()` in `runProviderRequest(settings, ...)`.
3. Preserve the combined Chrome Local Network Access and provider-unreachable guidance for Local providers.

The run ID, start retry/deduplication, heartbeat, terminal events, and cancellation remain unchanged.

## 5. Progress and completion presentation

Use neutral progress labels that fit both questions and actions:

- Initial: `요청을 이해하고 있어요` / `현재 페이지와 첨부를 살펴보고 필요한 계획을 세웁니다.`
- Model step: `요청 분석 및 계획 중`
- Tool step: existing action-specific progress
- Capture step: existing `화면 캡처 중`
- Final success: `응답을 완료했어요`
- Blocked safety result: keep the explicit safety-limit explanation

Plans remain internal by default. The final answer may summarize completed steps when useful, but must not reveal hidden chain-of-thought.

## 6. Files to change

### Runtime and background

- `src/shared/messages.ts`: remove analysis request contract and parser
- `src/shared/page.ts`: remove `PageAnalysisResult`
- `src/background/message-handler.ts`: remove analysis dependency and branch
- `src/background/index.ts`: remove `PageAnalysisService`
- `src/background/page-analysis-service.ts`: delete
- `src/background/agent-runner.ts`: adaptive prompt, no initial screenshot, bounded re-plan state/progress

### Side Panel

- `public/sidepanel.html`: remove secondary analysis button and leave one primary submit action
- `public/sidepanel.css`: change command action layout from two columns to one primary action plus conditional stop action
- `src/sidepanel/index.ts`: remove analysis flow, use one busy state, run Local Network Access probe before agent start, revise labels

### Tests and docs

- `tests/messages.test.ts`, `tests/message-handler.test.ts`: remove analysis contract and dependency fixtures
- `tests/agent-runner.test.ts`: direct-answer, action, on-demand capture, no initial capture, blocked re-plan, safety limit, attachments
- Side Panel/static tests: one action button, disabled/running/stop states, attachment lifecycle
- Delete `tests/page-analysis-service.test.ts`
- Update `README.md`, `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/PRD.md`, `docs/TEST_PLAN.md`, `docs/TODOLIST.md`, `docs/CAPTURE_AND_ATTACHMENTS_DESIGN.md`, and `docs/VERIFICATION.md`

## 7. Acceptance criteria

- The Side Panel exposes one submit action and no separate screen-analysis action.
- A simple page question can return a final answer without executing browser tools.
- An action request can observe, plan, request approval where required, execute, re-observe, and finish through the same lifecycle.
- Screenshot-disabled runs never capture.
- Screenshot-enabled runs do not capture automatically; the model can request a fresh screenshot when visual context is useful or progress is blocked.
- Attachments work identically for direct answers and action tasks.
- A repeated transition receives one bounded re-planning opportunity, then still terminates at the existing stall limit if no progress occurs.
- Local agent start performs the document-context Local Network Access probe and retains current user guidance.
- Start acknowledgement recovery, heartbeat/terminal recovery, cancellation, approvals, transcript guidance, tab pinning, empty-response recovery, 100-step limit, and 30-minute timeout remain intact.
- Format, lint, typecheck, full tests, build, audit, and 320px/480px static Side Panel QA pass.
- Real unpacked-Chrome/provider QA remains separately recorded and is not inferred from static testing.

## 8. Non-goals

- A visible chain-of-thought or detailed reasoning trace
- A new planning tool or persistent plan store
- Automatic screenshots without explicit request consent
- Continuous capture, full-page stitching, hidden-tab capture, or video recording
- Weakening action approval or blocked-input policies
- Changing provider protocols or adding dependencies
