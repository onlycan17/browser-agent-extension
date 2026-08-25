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

### `PAGE_ANALYZE_REQUEST`

```ts
{
  prompt: string;
  includeScreenshot: boolean;
}
```

### `AGENT_RUN_REQUEST`

```ts
{
  runId: string;
  instruction: string;
  includeScreenshot: boolean;
}
```

`runId`는 Side Panel이 요청 전에 생성하는 1~128자 식별자다. 따라서 실행 응답을 기다리지 않고 같은 ID로 즉시 취소할 수 있다.

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
    value?: string;
    disabled: boolean;
    bounds: { x: number; y: number; width: number; height: number };
  }>;
  youtube?: YouTubeState;
}
```

텍스트와 element 수에는 상한을 둔다. password 값과 숨김 값은 포함하지 않는다.

### `PAGE_CLICK`

```ts
{
  generation: number;
  elementId: string;
}
```

### `PAGE_TYPE_TEXT`

```ts
{
  generation: number;
  elementId: string;
  text: string;
  replace: boolean;
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

내부 system message는 top-level `system`, image URL은 base64/URL image source, function tool은 `input_schema`, assistant tool call은 `tool_use`, tool result는 user `tool_result` block으로 변환한다. 응답은 다시 공통 `AssistantMessage`와 `ToolCall`로 엄격히 파싱한 뒤 agent에 전달한다.

### Provider routing

Provider registry의 protocol이 `anthropic`이면 native client를 사용하고 나머지는 OpenAI-compatible client를 사용한다. Local provider 화면 분석은 reasoning token이 최종 답변 예산을 소진하지 않도록 `reasoning_effort: "none"`을 전송한다. Custom Base URL은 HTTPS만 허용되며 사용자 승인 origin의 optional host permission이 있어야 한다.

## 5. 에러 코드

- `INVALID_MESSAGE`: 내부 메시지 스키마 불일치
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
- `MODEL_PROTOCOL_ERROR`: 모델 응답 또는 tool arguments 파싱 실패
- `AGENT_SAFETY_LIMIT`: 동일 상태·동작 3회 정체, 100단계 또는 30분 안전 한도 도달
- `AGENT_CANCELLED`: 사용자 중단
