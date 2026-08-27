# Harness Checklist

## Baseline

- [x] Existing related tests: 51 passed before implementation
- [x] Five temporary characterization scenarios reproduced the identified gaps
- [x] Working tree was clean before implementation

## Agent progress

- [x] Alternating no-progress actions re-plan once and stop at three
- [x] Different text values do not create a false stall
- [x] Existing exact-repeat and volatile-page tests pass

## Transcript

- [x] Stable segment key continues after insertion before the numeric cursor
- [x] Non-adjacent duplicate segments are removed
- [x] Late segments found during end confirmation remain readable
- [x] Unchanged transcript end completes without an unbounded wait
- [x] Quiet-check timeout remains incomplete and produces a partial summary if continuation disappears
- [x] Cancellation and 64-chunk limit still pass

## Page settlement

- [x] Settled actions return `pageSettled: true`
- [x] Maximum-wait actions return `pageSettled: false`
- [x] Tool result exposes the flag and the successful signature is not replayed in the run

## Video

- [x] Finite media reports known duration and `isLive: false`
- [x] Infinite media reports unknown duration and `isLive: true`
- [x] Infinite and NaN duration reject `seek(0)`
- [x] Transcript guidance does not guarantee a fixed menu or panel position

## Multimodal capture

- [x] Consent disabled: capture tool unavailable
- [x] Consent is consumed at submission and reset again when the run closes
- [x] Consent enabled: capture image and provider-safe snapshot share one user message
- [x] Query strings and fragments are absent from paired context
- [x] Remaining same-turn tools are deferred, including capture after a preceding action
- [x] OpenAI-compatible and Anthropic serialization tests pass

## Final gates

- [x] Format check
- [x] Lint
- [x] Typecheck
- [x] Full tests
- [x] Build
- [x] Dependency audit
- [x] Static and browser smoke QA with a mocked Chrome runtime
- [x] Goal, code-quality, and security re-reviews passed with no blockers
