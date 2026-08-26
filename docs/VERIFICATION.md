# Verification Record

Date: 2026-08-26
Scope: unified adaptive agent, attachments/capture, and security hardening after real-browser adversarial QA

## Automated gates

Executed from the repository root after the final implementation changes:

| Command                            | Result                                                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm run format:check`             | Passed; all files match Prettier formatting                                                              |
| `npm run lint`                     | Passed; zero warnings and errors                                                                         |
| `npm run typecheck`                | Passed; zero TypeScript errors                                                                           |
| `npm run test:run`                 | Passed; 39 test files and 287 tests                                                                      |
| `npm run test:coverage`            | Passed; statements 83.70%, branches 74.41%, functions 92.84%, lines 89.67%                               |
| `npm run build`                    | Passed; PDF worker is non-empty and `cmaps/` is populated                                                |
| `npm audit --audit-level=moderate` | Passed; zero vulnerabilities                                                                             |
| forbidden-pattern scan             | Passed; no `as any`, TypeScript suppressions, dynamic code execution, debug logging, or secret-like keys |

Focused regression coverage includes:

- single agent runtime contract, same-`runId` start retry after transport acknowledgement loss, and background deduplication
- direct answers without tools, prompt-driven adaptive behavior, one bounded re-plan, and third-transition stall termination
- no consent-only initial screenshot, transient `capture_screen` recovery, deterministic failure caching, six-capture budget, and fresh-image deferral
- strict attachment runtime validation, aggregate limits, image signatures, UTF-8/truncation, and PDF errors
- OpenAI-compatible and Anthropic multiple-image serialization
- Side Panel attachment metadata, accessible removal, empty-list state, and inline help state
- PDF.js worker/CMap configuration, page order, cleanup, abort handling, and build-asset validation

## Static Side Panel browser QA

The built `dist/sidepanel.html` was served locally and inspected with Playwright. This validates layout and browser DOM behavior, not Chrome extension APIs or a real model provider.

| Scenario                           | Result                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 320px viewport                     | `clientWidth = 320`, `scrollWidth = 320`; no horizontal overflow                                            |
| 480px viewport                     | `clientWidth = 480`, `scrollWidth = 480`; no horizontal overflow                                            |
| Unified primary action             | One submit button labeled `보내기`; no `analyze-button`                                                     |
| Conditional stop                   | `stop-button` starts hidden and disabled                                                                    |
| Keyboard and live status           | Composer controls are focusable; live status uses `role="status"` and `aria-live="polite"`                  |
| Supported Markdown attachment      | `README.md` chip rendered with `Markdown · 4.9 KB` metadata and an accessible remove button                 |
| Unsupported follow-up file         | `index.ts 파일 형식은 지원하지 않습니다.` persisted in inline `data-state="error"` help and the live status |
| Failed addition state preservation | Existing `README.md` remained selected after the unsupported `index.ts` attempt                             |
| Removal                            | Chip removal hid the empty list and announced completion in the live region                                 |

The static harness reported an expected missing `chrome.runtime` error and a missing favicon because it was served as a normal HTTP page rather than loaded as an extension. These are not extension-context results.

## Actual unpacked-extension QA

An isolated Chromium profile loaded the production `dist/` extension. The toolbar action opened the real Side Panel and granted tab-scoped access. Synthetic sentinel values were used; the profile and fixtures were removed afterward.

| Scenario                                          | Result                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Local provider and model discovery                | Passed                                                                                            |
| Form fill, approval, deny, same-origin navigation | Passed                                                                                            |
| Request cancellation                              | Passed; active wait ended with cancellation and no later action                                   |
| Screenshot/canvas visual reading                  | Passed with request-scoped consent                                                                |
| TXT, PNG, text-PDF attachments                    | Passed; corrupt, scanned, encrypted, MIME-mismatched, and count-overflow inputs were rejected     |
| Password and labeled OTP fields                   | Rejected                                                                                          |
| Custom origin permission                          | Deny, allow, and provider-switch removal passed                                                   |
| API key storage lifecycle                         | Session-only value was not returned by settings, absent from local storage, and removed on switch |
| YouTube state and individual controls             | Pause, seek, playback rate, and volume passed                                                     |
| Tab switch during a run                           | Stopped safely; error precedence now reports `TAB_CHANGED` before new-tab access guidance         |
| Editable/offscreen privacy regression             | Passed; draft and offscreen sentinels were absent from the complete content snapshot              |
| Neutral `autocomplete=one-time-code` input        | Passed; metadata was observed but entry was rejected with `UNSAFE_ACTION`                         |
| Approval target mutation                          | Passed; changed/transparent target returned `STALE_ELEMENT` and neither click handler ran         |
| Focused Enter form submission                     | Passed; text was focused and `requestSubmit()` produced the verified form result                  |

## Remaining external/manual QA

- successful paid Cloud-provider requests with real API keys
- high-contrast and complete keyboard-only visual QA
- a public video where transcript controls are available, plus Local-model completion timing after the new fallback guidance
