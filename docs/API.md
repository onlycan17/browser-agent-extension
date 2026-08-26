# Browser Agent Extension Message and LLM API

## 1. 내부 메시지 공통 형식

```ts
interface ExtensionMessage<TType extends string, TPayload> {
  id: string;
  type: TType;
  payload: TPayload;
}

interface SuccessResponse<T> {
  ok: true;
  data: T;
}

interface ErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
}
```

모든 메시지는 runtime validator를 통과해야 한다. 알 수 없는 type과 추가 실행 필드는 거부한다.

## 2. Side Panel → Service Worker

### `SETTINGS_GET`

설정 화면에 노출 가능한 값만 반환한다. API key 원문은 반환하지 않고 `hasApiKey`만 제공한다.

### `SETTINGS_SAVE`

```ts
{
  provider:
    | "local"
    | "openai"
    | "anthropic"
    | "openrouter"
    | "groq"
    | "together"
    | "deepseek"
    | "mistral"
    | "xai"
    | "custom";
  baseUrl: string;
  model: string;
  apiKey?: string;
  rememberApiKey: boolean;
}
```

Preset `baseUrl`은 provider registry의 고정 공식 URL과 일치해야 한다. Custom은 credential, query, hash가 없는 HTTPS versioned Base URL만 허용하며 저장 전에 해당 origin의 optional host permission을 사용자에게 요청한다.

### `CONNECTION_TEST`

선택된 provider의 model 목록 endpoint를 호출한다. OpenAI-compatible provider는 `{baseUrl}/models`, Anthropic은 `{baseUrl}/v1/models`를 사용한다. 응답은 모델 ID 목록과 선택 모델 존재 여부만 반환한다.

### 첨부파일 계약

```ts
type RequestAttachment =
  | {
      kind: "image";
      name: string;
      mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
      dataUrl: string;
      size: number;
    }
  | {
      kind: "text";
      name: string;
      mediaType:
        | "text/plain"
        | "text/markdown"
        | "text/csv"
        | "application/json"
        | "text/html"
        | "application/xml"
        | "application/pdf";
      text: string;
      size: number;
      truncated: boolean;
    };
```

요청당 최대 5개, 전체 10MB, 추출 텍스트 전체 64,000자다. filename, MIME/확장자, data URL의 실제 decoded size, 파일별 크기와 텍스트 길이를 Service Worker가 다시 검증한다. 텍스트와 PDF는 명시적인 untrusted data 경계 안에 넣고 이미지는 multimodal content로 전달한다.

### `AGENT_RUN_REQUEST`

```ts
{
  runId: string;
  instruction: string;
  allowScreenshots: boolean;
  attachments: RequestAttachment[];
}
```

`runId`는 Side Panel이 요청 전에 생성하는 1~128자 식별자다. Service Worker는 실행 등록을 시작한 뒤 `{ runId, started: true }`를 즉시 반환하며, 실제 결과는 `AGENT_FINISHED` 또는 `AGENT_FAILED` event로 전달한다.

### `AGENT_KEEPALIVE`

```ts
{
  runId: string;
}
```

Side Panel은 실행 중 20초마다 heartbeat를 보낸다. Service Worker는 실행 중이면 `{ state: "active" }`, terminal event 전송 후이면 `{ state: "terminal", event }`, 실행 상태와 복구 가능한 terminal event가 모두 없으면 `{ state: "missing" }`을 반환한다. Side Panel은 terminal event 유실을 heartbeat 응답으로 복구하고, `missing`이면 실행 상태 유실을 안내한 뒤 UI를 정리한다.

### `AGENT_CANCEL`

```ts
{
  runId: string;
}
```

### `ACTION_APPROVAL_DECISION`

```ts
{
  runId: string;
  approvalId: string;
  approved: boolean;
}
```

### Service Worker terminal events

```ts
{
  type: "AGENT_FINISHED";
  payload: {
    runId: string;
    status: "completed" | "cancelled" | "safety_limit";
    answer: string;
    steps: number;
  }
}
```

```ts
{
  type: "AGENT_FAILED";
  payload: {
    runId: string;
    error: {
      code: string;
      message: string;
      retryable: boolean;
    }
  }
}
```

## 3. Service Worker ↔ Content Script

### `PAGE_OBSERVE`

응답:

```ts
{
  generation: number;
  url: string;
  title: string;
  viewport: { width: number; height: number; scrollX: number; scrollY: number };
  visibleText: string;
  elements: Array<{
    id: string;
    role: string;
    name: string;
    disabled: boolean;
    bounds: { x: number; y: number; width: number; height: number };
    inputType?: string;
    autocomplete?: string;
    href?: string;
    download?: boolean;
  }>;
  youtube?: YouTubeState;
}
```

텍스트와 element 수에는 상한을 둔다. `visibleText`는 현재 뷰포트와 교차하는 렌더링 텍스트만 포함하며 입력 요소와 `contenteditable` 초안을 제외한다. 입력값은 종류와 관계없이 포함하지 않는다.

### `PAGE_CLICK`

```ts
{
  generation: number;
  elementId: string;
  expected: ObservedElement;
}
```

### `PAGE_TYPE_TEXT`

```ts
{
  generation: number;
  elementId: string;
  text: string;
  replace: boolean;
  expected: ObservedElement;
}
```

### `PAGE_SCROLL`

```ts
{
  direction: "up" | "down" | "left" | "right";
  amount: number;
}
```

### `PAGE_PRESS_KEY`

허용 키: `Enter`, `Escape`, `Tab`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`.

`expected`는 `PAGE_OBSERVE`에서 받은 해당 요소 원본이다. Content Script는 실제 동작 직전에 요소의 가시성, 이름, 역할, 입력 메타데이터와 위치를 다시 비교하며 달라졌으면 실행하지 않는다. 텍스트 입력은 대상을 먼저 focus하고, focus된 폼 입력에서 승인된 `Enter`는 브라우저 폼 검증을 거쳐 `requestSubmit()`으로 제출한다.

### `YOUTUBE_CONTROL`

```ts
{
  action: "play" | "pause" | "seek" | "set_volume" | "set_rate";
  value?: number;
}
```

## 4. LLM 요청

### OpenAI-compatible providers

Local, OpenAI, OpenRouter, Groq, Together AI, DeepSeek, Mistral, xAI, Custom은 다음 endpoint를 사용한다.

```text
GET  {baseUrl}/models
POST {baseUrl}/chat/completions
```

Local `GET /models`는 불필요한 private-network preflight를 피하기 위해 API key가 없으면 별도 헤더 없이 요청한다. completion은 다음 헤더를 사용한다.

OpenAI, Anthropic, OpenRouter, Groq, Together AI, DeepSeek, Mistral, xAI는 registry에서 API key 필수로 분류하며, 누락 시 ProviderClientRouter가 HTTP 요청 전에 `PROVIDER_REJECTED`를 반환한다. Local과 Custom은 endpoint 정책에 따라 key 없이 요청할 수 있다.

```text
Content-Type: application/json
Authorization: Bearer {apiKey}  # 현재 선택된 provider에 저장된 apiKey가 있을 때만
```

비전 요청의 user content:

```json
[
  { "type": "text", "text": "사용자 요청과 DOM snapshot" },
  {
    "type": "image_url",
    "image_url": { "url": "data:image/png;base64,..." }
  }
]
```

Agent에서 `allowScreenshots`가 true인 요청에만 zero-argument `capture_screen` 도구를 추가한다. 허용만으로 초기 화면을 캡처하지 않으며, 모델이 시각 정보가 필요하거나 DOM 기반 진행이 막혔을 때 요청한 캡처만 run당 최대 6회 수행한다. 새 캡처 뒤 같은 응답의 나머지 tool call은 deferred 처리하고 최신 DOM snapshot과 이미지를 다음 모델 단계에 전달한다.

도구 정의:

```json
{
  "type": "function",
  "function": {
    "name": "click_element",
    "description": "Clicks an observed element",
    "parameters": {
      "type": "object",
      "properties": {
        "generation": { "type": "integer" },
        "elementId": { "type": "string" }
      },
      "required": ["generation", "elementId"],
      "additionalProperties": false
    }
  }
}
```

모델 tool call:

```json
{
  "role": "assistant",
  "tool_calls": [
    {
      "id": "call_123",
      "type": "function",
      "function": {
        "name": "click_element",
        "arguments": "{\"generation\":1,\"elementId\":\"e-3\"}"
      }
    }
  ]
}
```

도구 결과:

```json
{
  "role": "tool",
  "tool_call_id": "call_123",
  "content": "{\"ok\":true}"
}
```

### Anthropic native provider

```text
GET  https://api.anthropic.com/v1/models
POST https://api.anthropic.com/v1/messages
```

```text
x-api-key: {apiKey}
anthropic-version: 2023-06-01
anthropic-dangerous-direct-browser-access: true
Content-Type: application/json  # POST only
```

내부 system message는 top-level `system`, image URL은 base64/URL image source, function tool은 `input_schema`, assistant tool call은 `tool_use`, tool result는 user `tool_result` block으로 변환한다. 응답 형식과 tool input은 엄격히 파싱하되, 구조적으로 유효한 빈 assistant turn과 reasoning-only turn은 공통 `AssistantMessage`로 정규화해 agent의 bounded recovery에 전달한다.

### Provider routing

Provider registry의 protocol이 `anthropic`이면 native client를 사용하고 나머지는 OpenAI-compatible client를 사용한다. Local agent 실행은 reasoning token이 최종 답변 또는 tool call 예산을 소진하지 않도록 `reasoning_effort: "none"`을 전송한다. Agent 응답에 trim된 text와 tool call이 모두 없으면 최대 2회 계속 요청을 보내고, 세 번째 빈 응답은 `MODEL_PROTOCOL_ERROR`로 처리한다. 동일한 페이지·동작 전환이 두 번째 반복되면 한 번만 다른 접근 방식을 요청하고, 세 번째에도 정체되면 `safety_limit`으로 종료한다. Custom Base URL은 HTTPS만 허용되며 사용자 승인 origin의 optional host permission이 있어야 한다.

## 5. 에러 코드

- `INVALID_MESSAGE`: 내부 메시지 스키마 불일치
- `RUNTIME_UNAVAILABLE`: Side Panel과 Service Worker 사이 message channel 연결 실패
- `AGENT_RUN_LOST`: Service Worker 재시작 등으로 활성 run과 복구 가능한 terminal event가 모두 유실됨
- `UNSUPPORTED_PAGE`: script를 주입할 수 없는 페이지
- `TAB_ACCESS_REQUIRED`: toolbar action 재클릭이 필요한 임시 탭 권한 만료
- `CAPTURE_FAILED`: Chrome 화면 캡처 거부 또는 유효하지 않은 이미지 반환
- `STALE_ELEMENT`: 관찰 세대가 현재 DOM과 다름
- `ELEMENT_NOT_FOUND`: element ID가 존재하지 않음
- `UNSAFE_ACTION`: 정책상 금지된 동작
- `APPROVAL_REQUIRED`: 사용자 승인이 필요한 동작
- `PROVIDER_UNREACHABLE`: LLM 서버 연결 실패
- `PROVIDER_TIMEOUT`: 외부 요청 시간 초과 (Local 480초, OpenAI 45초, 기타 Cloud/Custom 120초)
- `PROVIDER_REJECTED`: 인증 또는 요청 형식 오류
- `MODEL_PROTOCOL_ERROR`: 모델 응답 또는 tool arguments 파싱 실패, agent의 반복된 빈 응답
- `AGENT_SAFETY_LIMIT`: 동일 상태·동작 3회 정체, 100단계 또는 30분 안전 한도 도달
- `AGENT_CANCELLED`: 사용자 중단
