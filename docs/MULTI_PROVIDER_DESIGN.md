# Multi-provider LLM Design

## 1. 목표

Browser Agent의 기존 Local/LM Studio 및 OpenAI 연결을 유지하면서 Anthropic, OpenRouter, 기타 OpenAI-compatible LLM API를 설정 화면에서 선택·등록하고 통합 에이전트 실행에 사용할 수 있게 한다.

## 2. 지원 범위

| Provider          | Protocol            | Base URL                         | 기본 모델                                 | 권한 방식                                   |
| ----------------- | ------------------- | -------------------------------- | ----------------------------------------- | ------------------------------------------- |
| Local / LM Studio | OpenAI-compatible   | `http://192.168.10.105:3620/v1`  | `qwen/qwen3.8-27b`                        | 고정 host permission + Local Network Access |
| OpenAI            | OpenAI-compatible   | `https://api.openai.com/v1`      | `gpt-4.1-mini`                            | 고정 host permission                        |
| Anthropic         | Native Messages API | `https://api.anthropic.com`      | `claude-sonnet-4-5`                       | 고정 host permission                        |
| OpenRouter        | OpenAI-compatible   | `https://openrouter.ai/api/v1`   | `anthropic/claude-sonnet-4.5`             | 고정 host permission                        |
| Groq              | OpenAI-compatible   | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile`                 | 고정 host permission                        |
| Together AI       | OpenAI-compatible   | `https://api.together.xyz/v1`    | `meta-llama/Llama-3.3-70B-Instruct-Turbo` | 고정 host permission                        |
| DeepSeek          | OpenAI-compatible   | `https://api.deepseek.com`       | `deepseek-chat`                           | 고정 host permission                        |
| Mistral           | OpenAI-compatible   | `https://api.mistral.ai/v1`      | `mistral-small-latest`                    | 고정 host permission                        |
| xAI               | OpenAI-compatible   | `https://api.x.ai/v1`            | `grok-4-latest`                           | 고정 host permission                        |
| Custom            | OpenAI-compatible   | 사용자 입력 HTTPS URL            | 사용자 입력                               | 선택한 origin의 optional host permission    |

Custom provider는 별도 프리셋이 없는 OpenAI-compatible `/models`와 `/chat/completions` 업체를 대상으로 한다. 업체별 비표준 API 기능과 Gemini native API는 이번 범위에서 제외한다.

## 3. 핵심 설계

### 3.1 Provider registry

`ProviderId`를 다음 값으로 확장한다.

```text
local | openai | anthropic | openrouter | groq | together | deepseek | mistral | xai | custom
```

각 provider의 label, protocol, 기본 Base URL, 기본 모델, timeout, API key 안내, Base URL 편집 가능 여부를 하나의 registry에서 제공한다. 설정 parser, 설정 UI, client router가 같은 registry 정보를 사용해 분기 중복을 줄인다.

### 3.2 Client routing

내부 `ChatRequest`와 `AssistantMessage` 형식은 유지한다.

```text
ProviderClient
├── OpenAICompatibleClient: local, openai, openrouter, custom
└── AnthropicClient: anthropic
```

`ProviderRouter`가 `settings.provider`에 따라 적절한 client를 선택한다. AgentRunner와 MessageHandler는 router의 공통 `testConnection()`과 `complete()`만 호출하므로 provider별 구현을 알지 않는다.

### 3.3 Anthropic translation

Anthropic은 `POST https://api.anthropic.com/v1/messages`를 사용한다.

필수 헤더:

- `x-api-key`
- `anthropic-version: 2023-06-01`
- `anthropic-dangerous-direct-browser-access: true`
- `content-type: application/json`

변환 규칙:

- internal `system` message → top-level `system`
- user text → Anthropic user text block
- `data:image/...;base64,...` → Anthropic base64 image source
- OpenAI function tool → Anthropic `name`, `description`, `input_schema`
- assistant `tool_calls` → Anthropic `tool_use` blocks
- internal tool result → user `tool_result` block
- response `text` blocks → assistant text
- response `tool_use` blocks → internal `ToolCall`

모델 연결 검사는 인증 헤더와 함께 `GET /v1/models`를 호출한다. 지원하지 않는 응답이나 잘못된 tool input은 `MODEL_PROTOCOL_ERROR`로 처리한다.

### 3.4 OpenRouter

기존 OpenAI-compatible request/response 변환을 사용한다.

- Base URL: `https://openrouter.ai/api/v1`
- 모델 조회: `GET /models`
- completion: `POST /chat/completions`
- 인증: `Authorization: Bearer <key>`

선택 사항인 `HTTP-Referer`와 `X-OpenRouter-Title`은 사용자의 확장 ID 노출과 불필요한 추적을 피하기 위해 기본 전송하지 않는다.

### 3.5 Custom provider permission

Custom Base URL은 다음 조건을 모두 만족해야 한다.

- `https:` scheme
- username/password 없음
- query/hash 없음
- 정규화 후 길이 제한 통과

Manifest에는 `optional_host_permissions: ["https://*/*"]`만 선언한다. 설정 저장 또는 연결 확인이라는 사용자 동작 안에서 `chrome.permissions.request()`로 선택한 origin 하나만 요청한다. 권한이 거부되면 설정을 저장하거나 provider 요청을 보내지 않는다.

Provider를 custom에서 다른 provider로 변경하거나 custom origin을 바꾸면 이전 custom origin 권한을 제거한다.

### 3.6 API key lifecycle

- API key는 `{ value, provider, origin }` scope와 함께 기본 `chrome.storage.session`, 명시적 선택 시 `chrome.storage.local`에 저장한다.
- 설정 조회 응답은 key 원문을 반환하지 않고 `hasApiKey`만 반환한다.
- provider 또는 Custom origin이 바뀌거나 공개 설정이 손상되면 기존 key를 제거한다.
- key, Authorization/x-api-key header, provider error body는 로그 또는 사용자 오류 메시지에 포함하지 않는다.
- 모든 Cloud preset은 registry의 `requiresApiKey`를 사용해 API key 필요 안내를 표시하고, 누락 시 ProviderClientRouter가 네트워크 요청 전에 명확한 오류를 반환한다. 기존 저장 key가 있으면 빈 입력으로 교체하지 않는다. Local과 Custom은 서버 정책에 따라 key 없이 사용할 수 있다.

### 3.7 Timeouts and cancellation

| Provider                                                         | Timeout |
| ---------------------------------------------------------------- | ------- |
| Local                                                            | 480초   |
| OpenAI                                                           | 45초    |
| Anthropic, OpenRouter, Groq, Together AI, DeepSeek, Mistral, xAI | 120초   |
| Custom                                                           | 120초   |

모든 provider는 기존 AbortSignal 취소, timeout controller, timer/listener 정리를 동일하게 적용한다. 자동 재시도는 브라우저 조작 agent에서 중복 요청과 비용을 만들 수 있으므로 이번 범위에 추가하지 않는다.

## 4. 설정 UI

- Provider select에 Anthropic, OpenRouter, Groq, Together AI, DeepSeek, Mistral, xAI, Custom을 추가한다.
- preset provider의 Base URL은 readonly, Custom은 editable로 전환한다.
- provider별 기본 모델과 안내 문구를 registry에서 표시한다.
- Local에는 LAN 경고, Custom에는 HTTPS와 origin 권한 안내를 표시한다.
- 연결 검사는 모델 목록을 조회하고 선택 모델 존재 여부를 표시한다.
- Custom 권한 거부, API key 누락·거부, 모델 미발견을 서로 다른 메시지로 표시한다.

## 5. 보안 경계

- native provider 응답도 기존 strict parser를 통과한 canonical `AssistantMessage`로만 변환한다.
- tool 이름과 arguments는 기존 AgentToolExecutor에서 다시 검증한다.
- custom provider는 API 응답을 신뢰하지 않으며 임의 HTML, script, URL 실행 권한을 얻지 않는다.
- custom provider host permission은 사용자가 선택한 HTTPS origin으로 제한한다.
- Anthropic의 direct-browser header는 API key가 확장 프로세스에 존재한다는 명시적 위험 안내와 함께 사용한다.

## 6. 마이그레이션

기존 `local`과 `openai` 공개 설정 형식은 그대로 유효하다. 신규 provider union과 registry만 확장하며 저장 key 이름은 변경하지 않는다. 다만 v0.1.x의 scope 없는 문자열 API key는 provider를 추정해 이관하지 않고 안전하게 제거하므로 사용자가 한 번 다시 입력해야 한다.

## 7. 테스트 계획

1. settings parser: 모든 preset, custom HTTPS, 금지 URL, timeout
2. provider defaults/registry: label, protocol, model, readonly 상태
3. repository: 같은 provider key 유지, provider 변경 key 제거
4. permission helper: custom origin 요청, 거부, 이전 origin 제거, preset bypass
5. OpenAI-compatible client: OpenRouter/custom URL·auth·models·tool/image
6. Anthropic client: headers, system/image/tool translation, tool result, response parse, malformed response, errors, abort, timeout
7. provider router: provider별 dispatch
8. manifest: fixed hosts and optional HTTPS host declaration
9. settings UI: provider 전환, custom editable URL, 안내와 연결 결과
10. full regression: direct answer, agent tool loop, on-demand capture, approval, Local LNA

## 8. 수용 기준

- 기존 Local/OpenAI 설정과 실행이 회귀 없이 동작한다.
- Anthropic API key와 모델을 저장해 연결 검사, 텍스트/이미지 분석, tool call agent를 실행할 수 있다.
- OpenRouter API key와 model ID를 저장해 같은 기능을 실행할 수 있다.
- OpenAI-compatible custom HTTPS endpoint를 등록하고 해당 origin 권한 승인 후 사용할 수 있다.
- provider 변경 시 이전 API key와 불필요한 custom origin 권한을 재사용하지 않는다.
- 포맷, 린트, 타입 검사, 전체 단위 테스트, 빌드, 브라우저 QA와 보안 검토를 통과한다.

## 9. 공식 참고 자료

- Anthropic Messages API: https://docs.anthropic.com/en/api/messages
- Anthropic TypeScript SDK browser safety: https://github.com/anthropics/anthropic-sdk-typescript
- OpenRouter API: https://openrouter.ai/docs/api/reference/overview
- Chrome extension permissions: https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions
