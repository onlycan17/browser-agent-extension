# Autonomous Capture and Attachments Design

Status: Implemented — automated and static Side Panel QA complete; real unpacked-Chrome/provider QA remains tracked separately.

## 1. Goal

Extend Browser Agent so that:

1. An agent run can request a fresh screenshot when visual evidence is necessary or DOM-based progress is blocked, including after scrolling or navigation.
2. A user can attach local images, text documents, and PDFs to the unified agent request.
3. The same request behaves consistently with Local/OpenAI-compatible and Anthropic providers without requiring a file-upload backend.

## 2. Recommended MVP scope

### Supported attachments

- Images: PNG, JPEG, WebP, GIF
- Text: TXT, Markdown, CSV, JSON, HTML, XML
- PDF: browser-side text extraction with PDF.js

Office documents, archives, audio, video, password-protected PDFs, OCR for scanned PDFs, and persistent attachment history are excluded from this iteration.

### Limits

- Maximum 5 files per request
- Maximum raw size: image 5 MB, text 1 MB, PDF 8 MB
- Maximum combined raw size: 10 MB
- Maximum extracted text: 32,000 characters per file and 64,000 characters per request
- Truncated documents carry an explicit truncation notice
- Attachment bytes and extracted text remain in memory only and are cleared after the request is accepted or the user removes them

The limits protect MV3 runtime messaging, browser memory, provider context windows, and Local model latency.

## 3. Autonomous screenshot behavior

The agent request uses `allowScreenshots` as request-scoped consent and exposes a zero-argument `capture_screen` tool only when this flag is true.

- The checkbox label is `화면 캡처 허용` and states that the model may capture the visible viewport during this request.
- Enabling consent does not capture the initial screen automatically.
- The model may request up to 6 captures in one run when visual evidence is useful or DOM-based progress is blocked.
- `TabService` retains its 550 ms interval, staying below Chrome's two-captures-per-second limit.
- A capture validates the pinned tab/window/origin before and after capture.
- A successful capture closes the tool call with a text result and appends the screenshot as untrusted user image data for the next model step.
- Remaining calls from the same model response are deferred so the model must inspect the fresh screenshot before acting.
- Cancellation, 30-minute timeout, 100-step emergency limit, and repeated-transition detection remain active.
- Capturing is observational and does not require action approval, but it is impossible unless the user enabled the request-scoped screenshot option.

Only the currently visible viewport is captured. Full-page stitching, hidden tabs, continuous recording, and tab media capture are excluded.

## 4. Attachment data flow

### Side Panel

Add an accessible attachment control to the composer:

- Hidden native `input[type=file]` with an explicit attachment button
- File chips showing name, type/size summary, extraction/truncation state, and a remove button
- Inline validation errors announced through the existing live region
- Controls disabled while a request is active
- User chat bubbles display attachment names but never render attached HTML

The side panel validates files before reading them. Images become data URLs. Text files are decoded as UTF-8. PDFs are parsed locally with PDF.js and reduced to bounded plain text.

### Runtime schema

Use a strict serializable union:

```ts
type RequestAttachment =
  | {
      kind: "image";
      name: string;
      mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
      dataUrl: string;
    }
  | {
      kind: "text";
      name: string;
      mediaType: string;
      text: string;
      truncated: boolean;
    };
```

`AGENT_RUN_REQUEST` receives `attachments`. Runtime validation repeats all count, filename, MIME, data URL, and content-size checks; UI validation alone is not trusted.

### Provider-neutral prompt construction

- Image attachments use the existing `image_url` internal part. OpenAI-compatible clients forward data URLs and Anthropic converts them to base64 image blocks.
- Text and extracted PDF content are wrapped in explicit untrusted-document boundaries containing a sanitized filename and truncation state.
- Document text is never placed in the system prompt and cannot change tool permissions or safety policy.
- Page data, attachment data, and the user's instruction remain visibly separated in the model message.

Native OpenAI `file` parts and Anthropic `document` blocks are intentionally not used in the MVP because Local and Custom OpenAI-compatible servers do not reliably implement them. Local extraction gives every provider the same contract.

## 5. PDF dependency

Use Mozilla `pdfjs-dist` pinned to an exact version. It is actively maintained, Apache-2.0 licensed, and avoids implementing a PDF parser in application code.

- Bundle the PDF.js worker as a local extension asset; no remote code is allowed by CSP.
- Copy packed CMaps into `dist` for PDFs using non-embedded CJK/CID fonts.
- Parse from `ArrayBuffer`; do not resolve document URLs or external resources.
- Disable JavaScript evaluation and do not render PDF HTML.
- Run `npm audit`, full tests, and production build after adding the dependency.

## 6. Security and privacy

- File contents and screenshots are sent only to the provider selected by the user.
- No attachment data is written to Chrome storage, logs, error messages, or chat HTML.
- Filenames are metadata only, bounded to 255 characters, and rendered with `textContent`.
- MIME allowlists are checked against both `File.type` and extension; unsupported or conflicting files are rejected.
- Data URLs must use an allowed image MIME and valid base64 payload.
- PDF extraction ignores embedded scripts, links, forms, and attachments.
- Attachment text and screenshots are explicitly labeled untrusted data to reduce prompt-injection risk.
- Capture remains request-scoped and gated by the user's checkbox plus existing `activeTab` permission.

## 7. Implementation map

### New modules

- `src/shared/attachments.ts`: attachment types, constants, runtime validation, prompt conversion
- `src/sidepanel/attachment-reader.ts`: image/text reading and PDF extraction orchestration
- `src/sidepanel/attachment-state.ts`: request-scoped selection/removal state

### Existing modules

- `public/sidepanel.html`, `public/sidepanel.css`: attachment picker/chips and revised capture consent
- `src/sidepanel/index.ts`: collect attachments, render state, include them in requests, clear lifecycle
- `src/shared/messages.ts`: strict request payload parsing
- `src/shared/llm.ts`: compose multiple text/image parts
- `src/background/agent-tools.ts`: `capture_screen` schema, validation, request-scoped enforcement, screenshot follow-up
- `src/background/agent-runner.ts`: capture capability/budget and defer-after-capture flow
- `src/background/openai-client.ts`, `src/background/anthropic-client.ts`: verify existing image serialization remains compatible
- `scripts/build.mjs`: local PDF worker and CMap assets
- `public/manifest.json`: no new browser permission expected

## 8. Test plan

1. Attachment validator: supported kinds, MIME/extension mismatch, malformed data URL, count and all size boundaries.
2. Attachment reader: UTF-8 text, image data URL, PDF page ordering, CJK text, empty/scanned PDF, truncation, corrupt/password-protected PDF, cancellation.
3. Runtime messages: valid image/text payloads and every malformed/oversized variant.
4. Provider serializers: multiple images plus text for OpenAI-compatible and Anthropic.
5. Agent initialization and direct answers: untrusted attachment boundaries and no system-prompt contamination.
6. Capture tool: hidden when disabled, allowed when enabled, pinned-tab validation, rate limit, six-capture budget, defer remaining calls, cancellation and capture failure.
7. UI: picker keyboard access, chips/removal, error announcements, disabled running state, attachment-only rejection or prompt requirement, clear-on-accepted-request behavior.
8. Regression: transcript discovery, approval lifecycle, empty-response recovery, MV3 heartbeat/terminal recovery, 100-step/30-minute safety limits.
9. Browser QA: real text/image/PDF upload with Local provider, capture after scroll, denied activeTab recovery, 320 px and 480 px layouts.

## 9. Acceptance criteria

- A checked screenshot option lets the model request and inspect a fresh visible-tab screenshot during an active run.
- An unchecked option prevents both initial and model-requested captures.
- Users can add, inspect, remove, and submit supported attachments without persistence.
- Local/OpenAI-compatible and Anthropic receive equivalent image/text information.
- Unsupported, oversized, corrupt, or unsafe files fail before provider transmission with a specific user-facing message.
- Existing safety, cancellation, navigation, lifecycle recovery, and provider behavior remains intact.
- Format, lint, typecheck, unit tests, production build, dependency audit, and unpacked Chrome QA pass.
