# Adaptive Reliability and Multimodal Page Context Design

Status: Approved for implementation

## Goal

Improve long-running browser and video analysis while preserving the unified agent, request-scoped consent, provider neutrality, and deterministic safety boundaries.

## Scope

1. Detect no-progress cycles even when ineffective actions alternate.
2. Keep transcript continuation stable while the transcript DOM changes, remove duplicate segments, and confirm a quiet transcript end.
3. Preserve the result of bounded page settlement instead of silently discarding it.
4. Distinguish live or unknown-duration YouTube media and make transcript discovery observation-first.
5. Pair a user-approved visible-viewport capture with the matching provider-safe page observation in one multimodal message.

## Contracts

### No-progress detection

- Keep exact transition detection.
- Also count consecutive unchanged page-state signatures across different actions.
- Do not infer no progress from changing `type_text` values because form values may be absent from observations.
- Re-plan once at the second blocked transition and stop at the third.

### Transcript continuation

- Every returned chunk carries a bounded `lastSegmentKey` derived from timestamp and normalized text.
- The next read supplies that key so an insertion before the previous numeric cursor cannot repeat or skip content.
- Duplicate timestamp/text segments are removed globally, not only when adjacent.
- A final chunk is returned only after a bounded DOM quiet check and a second read finds no additional segments. A quiet-check timeout keeps `done: false`; if continuation disappears, only the confirmed range is synthesized with `truncated: true`.
- Existing numeric cursors remain for bounds, progress, and backward-compatible diagnostics.

### Page settlement

- Actions that can trigger asynchronous DOM changes return `pageSettled: boolean`.
- The action remains successful even when the page is still changing because repeating it could duplicate an irreversible operation.
- The tool result exposes the unsettled state, the runner blocks that successful action signature for the rest of the run, and it supplies a fresh observation before the next model decision.

### Live video

- YouTube state exposes `isLive` and `durationKnown` while retaining finite numeric `duration`.
- Unknown, non-finite, or live duration remains non-seekable, including `seek(0)`.
- Transcript guidance follows observed labels and layout. YouTube's description/More path is a hint, not a fixed guarantee.

### Multimodal page context

- The existing request-scoped screenshot checkbox remains the only consent gate; Side Panel consumes and clears it when each request starts and defensively clears it again when the run closes.
- UI copy states that the selected model must support image input.
- No automatic initial capture occurs.
- If another tool precedes `capture_screen` in the same model response, capture is deferred until the preceding action is followed by a fresh observation.
- When the model requests `capture_screen` as the first tool at that decision point, the next user message contains both:
  - a provider-safe structured page observation from the same decision point;
  - the freshly captured visible viewport image.
- Both are labeled untrusted data. Screenshots are not stored, logged, or rendered in chat.
- OpenAI-compatible providers keep `image_url`; Anthropic keeps base64 image blocks.

## Out of scope

- Model-name heuristics for image capability
- Full-page stitching, hidden-tab capture, recording, OCR, or image persistence
- Unbounded transcript retries or arbitrary site selectors
- Automatic retries of actions that may already have succeeded

## Acceptance criteria

- Alternating ineffective scroll actions re-plan at step 2 and stop at step 3.
- Distinct text entry remains allowed when page text does not expose field values.
- Transcript insertions before the cursor neither duplicate nor skip the next segment.
- Late transcript segments discovered during the quiet check are included.
- Non-adjacent duplicate segments are removed.
- Unsettled actions report `pageSettled: false`; their successful action signature is not executed again in the same run.
- Live media is distinguishable from a real zero-duration video and rejects seek attempts.
- A captured image and provider-safe page observation appear in the same multimodal user message.
- Capture remains unavailable without explicit request-scoped consent, and consent returns to disabled immediately after submission.
- Related tests, full tests, format check, lint, typecheck, build, and audit pass.
