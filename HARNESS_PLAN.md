# Harness Plan

## Purpose

Provide repeatable evidence for adaptive reliability, transcript stability, page settlement, live video state, and consent-gated multimodal capture.

## Thin harness

Use the existing project commands first:

```bash
npm run test:run -- <related test files>
npm run format:check
npm run lint
npm run typecheck
npm run test:run
npm run build
npm audit
```

## Feature gates

1. Agent progress gate
   - `tests/agent-runner.test.ts`
   - alternating no-progress cycle, exact repeat, dynamic text, capture pairing and consent
2. Transcript gate
   - `tests/transcript-reader.test.ts`
   - `tests/transcript-summary-service.test.ts`
   - `tests/content-messages.test.ts`
3. Page settlement gate
   - `tests/page-settler.test.ts`
   - `tests/content-messages.test.ts`
   - `tests/agent-tools.test.ts`
4. Video state and guidance gate
   - `tests/youtube-adapter.test.ts`
   - `tests/page-observer.test.ts`
   - `tests/video-transcript-guidance.test.ts`
5. Provider serialization gate
   - `tests/openai-client.test.ts`
   - `tests/anthropic-client.test.ts`

## Manual smoke checks

- With screenshot consent disabled, confirm `capture_screen` is absent.
- With consent enabled and an image-capable model, request visual analysis after scrolling and confirm a response uses current viewport details.
- Confirm no screenshot bytes appear in chat, storage, logs, or error text.
- Open a YouTube transcript and confirm full-summary behavior without waiting for playback.

## Regression record

Record each discovered failure and its passing regression in `HARNESS_CHECKLIST.md` and update `docs/VERIFICATION.md` after the final gate.
