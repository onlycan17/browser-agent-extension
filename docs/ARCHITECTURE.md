# Browser Agent Extension Architecture

## 1. 구성 요소

```text
Side Panel UI
  | chrome.runtime messages
Service Worker
  |-- SettingsRepository
  |-- ProviderClientRouter
  |     |-- OpenAICompatibleClient
  |     `-- AnthropicClient
  |-- AgentRunner
  |-- SafetyPolicy
  |-- TabCaptureService
  |
  | chrome.tabs / chrome.scripting / chrome.tabs.sendMessage
Content Script
  |-- PageObserver
  |-- ElementRegistry
  |-- PageActionExecutor
  |-- YouTubeAdapter
  |
Current Web Page
```

## 2. 책임 경계

### Side Panel

- 사용자 요청과 실행 상태를 표시한다.
- 프로바이더 설정과 연결 검사를 제공한다.
- 위험 동작 승인 또는 거부를 서비스 워커에 전달한다.
- 페이지 HTML을 직접 신뢰하거나 실행하지 않는다.

### Service Worker

- 권한이 필요한 Chrome API와 외부 API 호출을 전담한다.
- LLM 메시지와 tool schema를 구성한다.
- 모델의 tool call을 검증하고 `SafetyPolicy`를 통과시킨다.
- content script에 임의 URL fetch 또는 임의 코드 실행 권한을 위임하지 않는다.
- API key는 provider/origin scope와 함께 `chrome.storage.session`에 보관하고 현재 유효한 설정과 scope가 일치할 때만 사용한다. provider 또는 Custom origin 변경과 손상된 설정 fallback에서는 stale key를 제거한다. 실행 중 controller와 승인은 메모리에만 유지하며, Service Worker 재시작 시 안전하게 취소하고 자동 재개하지 않는다.

### Content Script

- 현재 문서의 제한된 DOM 정보를 수집한다.
- 관찰 시점마다 짧은 수명의 element ID를 발급한다.
- 허용된 명령만 수행하며 selector 또는 JavaScript 문자열을 실행하지 않는다.
- 페이지에서 받은 메시지는 확장 메시지로 간주하지 않는다.

## 3. 데이터 흐름

### 관찰

1. Local provider 연결 확인 시 Side Panel 또는 설정 문서가 공통 helper의 무인증 `/models` probe로 Chrome의 Local Network Access 권한을 먼저 요청한다.
2. 사용자가 대상 탭에서 툴바 action을 클릭하면 background가 `chrome.sidePanel.open({ tabId })`로 tab-scoped panel을 열고 `activeTab` 권한을 획득한다.
3. Side Panel이 선발급한 `runId`와 함께 `AGENT_RUN_REQUEST`를 보낸다.
4. Service Worker가 Chrome의 마지막 포커스 창에서 활성 탭을 확인하고 해당 실행을 탭 ID, 창 ID, 시작 URL에 고정한다.
5. Content Script가 `PAGE_OBSERVE`를 받아 구조화된 snapshot을 반환한다.
6. 화면이 필요한 경우 Service Worker가 PNG 캡처를 추가한다.
7. Provider에 전달할 snapshot의 현재 페이지 URL은 origin만 남기고 path, query, fragment를 제거한다. 내부 탭 고정과 UI 결과는 원본 URL을 유지한다.
8. ProviderClientRouter가 registry의 protocol에 따라 OpenAI-compatible client 또는 Anthropic native client로 텍스트와 선택적 이미지를 보낸다.

### 도구 실행

1. 모델 응답의 `tool_calls[].function.arguments`를 JSON으로 파싱한다.
2. 도구별 validator가 정확한 스키마를 검사한다.
3. SafetyPolicy가 차단, 승인 필요, 즉시 허용 중 하나를 반환한다.
4. 승인 필요 시 실행을 일시 정지하고 Side Panel에 요청 전체 승인 카드를 보낸다. 사용자가 승인하면 같은 `runId`의 후속 `confirm` 동작은 추가 카드 없이 허용하며, 완료·취소·안전 한도 종료 시 grant를 폐기한다. `deny` 동작에는 grant를 적용하지 않는다.
5. 각 관찰·캡처·동작 전후에 탭 ID, 창 ID, URL을 확인하고 관찰 snapshot의 URL도 대조한다. 탭·창 전환과 예상하지 않은 navigation은 실행을 중단한다. 사용자 승인 후 실행한 클릭 또는 Enter는 다음 관찰까지 same-origin navigation 1회를 허용하고 pin URL을 갱신한다.
6. 클릭 또는 Enter를 실행하면 같은 모델 응답의 남은 tool call은 deferred 결과로 닫고 새 snapshot을 관찰한 뒤 다음 모델 단계에서 다시 판단한다. action 응답이 unload로 유실돼도 allowance는 이 관찰까지만 유지된다.
7. 허용된 명령만 Content Script 또는 Chrome API로 전달한다.
8. 실행 결과를 `role: tool` 메시지로 모델에 반환한다.

### 실행 종료

1. 모델이 tool call 없는 최종 텍스트를 반환하면 정상 완료한다.
2. URL, viewport, 숫자형 시각 정보가 정규화된 visible text, 안정 element 속성, 안정 YouTube 상태와 tool call 묶음이 3회 반복되면 정체로 판단한다. 입력 text는 원문 대신 fingerprint로 비교한다.
3. 정체하거나 100단계 또는 30분 비상 한도에 도달하면 `safety_limit`으로 종료한다. 30분 deadline은 초기 관찰부터 모델·승인·도구 대기까지 전체 run의 `AbortController`에 적용한다.
4. 사용자의 중지 요청은 단계와 무관하게 동일한 `AbortController`로 진행 중 대기를 즉시 취소한다.

## 4. 빌드 구조

```text
browser-agent-extension/
  docs/
  public/
    manifest.json
    icons/
  src/
    background/
    content/
    sidepanel/
    settings/
    shared/
  tests/
  package.json
  tsconfig.json
  scripts/
    build.mjs
  vitest.config.ts
```

esbuild는 Service Worker, Content Script, Side Panel, Settings 엔트리를 각각 분할 없는 독립 번들로 만든다. remote code를 사용하지 않고 모든 런타임 JavaScript와 CSS를 패키지에 포함한다.

## 5. 권한 설계

필수 permissions:

- `activeTab`: 사용자 동작으로 현재 탭 접근 및 캡처
- `scripting`: content script 주입
- `sidePanel`: 사이드 패널 UI
- `storage`: 설정과 실행 상태 저장

고정 host permissions:

- `http://192.168.10.105:3620/*`
- `https://api.openai.com/*`
- `https://api.anthropic.com/*`
- `https://openrouter.ai/*`
- `https://api.groq.com/*`
- `https://api.together.xyz/*`
- `https://api.deepseek.com/*`
- `https://api.mistral.ai/*`
- `https://api.x.ai/*`

Custom provider는 `optional_host_permissions`의 HTTPS 범위 안에서 사용자가 저장할 때 선택한 origin 하나만 `chrome.permissions.request()`로 승인한다. provider 또는 custom origin이 변경되면 기존 custom origin 권한을 제거한다. 일반 웹 사이트는 광범위한 영구 host permission 대신 `activeTab`으로 접근한다.

## 6. 주요 설계 결정

### ADR-001: Chat Completions 사용

LM Studio와 OpenAI에서 공통으로 지원하고 tool call 메시지 형식이 단순하므로 MVP는 `/chat/completions`를 사용한다. Responses API는 후속 범위로 둔다.

### ADR-002: Native Anthropic adapter와 provider registry

Local, OpenAI, OpenRouter, Groq, Together AI, DeepSeek, Mistral, xAI, Custom은 OpenAI-compatible client를 공유한다. Anthropic은 system, image, tool use/result 형식이 달라 native Messages API adapter로 내부 canonical message와 양방향 변환한다. UI, validator, timeout, routing은 하나의 provider registry를 기준으로 한다.

### ADR-003: 비스트리밍 우선

에이전트 상태 복구와 도구 호출 파싱을 단순하게 유지하기 위해 MVP는 비스트리밍 요청을 사용한다. 요청에는 AbortController 기반 타임아웃과 사용자 중단을 적용한다.

### ADR-004: DOM 우선, 스크린샷 보조

일반 작업은 구조화된 DOM snapshot으로 처리하고 시각적 이해가 필요할 때만 스크린샷을 보낸다. 이는 민감 데이터 노출과 토큰 비용을 줄인다.

### ADR-005: 안정 selector 대신 일회성 element ID

모델이 CSS selector를 생성하지 못하게 하고 관찰 결과의 ID만 사용한다. DOM 변경 시 registry 세대를 증가시켜 오래된 참조를 거부한다.

### ADR-006: YouTube 전용 adapter

일반 DOM 도구로 비디오를 조작하지 않고 `<video>` 상태를 검증하는 전용 명령만 허용한다. 자막 추출은 페이지 변화에 취약하므로 가용할 때만 사용하는 보조 경로다.

### ADR-007: 최상위 문서 관찰 우선

MVP의 DOM snapshot은 활성 탭의 최상위 문서와 일반 light DOM만 관찰한다. closed/open shadow root 내부와 cross-origin iframe 내부는 수집하지 않으며, iframe은 별도 frame 권한과 명시적 사용자 동의가 필요한 후속 범위로 둔다.
