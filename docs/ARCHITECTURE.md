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
  |-- TranscriptSummaryService
  |-- SafetyPolicy
  |-- TabCaptureService
  |
  | chrome.tabs / chrome.scripting / chrome.tabs.sendMessage
Content Script
  |-- PageObserver
  |-- ElementRegistry
  |-- PageActionExecutor
  |-- YouTubeAdapter
  |-- TranscriptReader
  |
Current Web Page
```

## 2. 책임 경계

### Side Panel

- 사용자 요청과 실행 상태를 표시한다.
- 프로바이더 설정과 연결 검사를 제공한다.
- 위험 동작 승인 또는 거부를 서비스 워커에 전달한다.
- 이미지·UTF-8 텍스트·PDF를 요청 메모리에서 검증·추출하고 수락된 요청 뒤 제거한다.
- 페이지 HTML과 첨부 HTML/PDF 내용을 직접 신뢰하거나 실행하지 않는다.

### Service Worker

- 권한이 필요한 Chrome API와 외부 API 호출을 전담한다.
- LLM 메시지와 tool schema를 구성한다.
- 모델의 tool call을 검증하고 `SafetyPolicy`를 통과시킨다.
- content script에 임의 URL fetch 또는 임의 코드 실행 권한을 위임하지 않는다.
- API key는 provider/origin scope와 함께 `chrome.storage.session`에 보관하고 현재 유효한 설정과 scope가 일치할 때만 사용한다. provider 또는 Custom origin 변경과 손상된 설정 fallback에서는 stale key를 제거한다. 실행 중 controller와 승인은 메모리에만 유지하며, Service Worker 재시작 시 안전하게 취소하고 자동 재개하지 않는다.

### Content Script

- 현재 뷰포트와 교차하고 실제 hit-test에서 가려지지 않은 상호작용 요소만 수집하며 입력 문자열 값과 편집 중 초안은 제외한다. Select 표시 라벨, check 상태, 내부 스크롤 가능 방향은 bounded 메타데이터로 구조화한다.
- 관찰 시점마다 짧은 수명의 element ID를 발급한다.
- 허용된 명령만 수행하며 selector 또는 JavaScript 문자열을 실행하지 않는다. 요소 동작은 관찰 상태 DOM guard가 실행 직전 상태와 일치하고 다른 요소에 가려지지 않았을 때만 수행한다.
- 페이지에서 받은 메시지는 확장 메시지로 간주하지 않는다.

## 3. 데이터 흐름

### 관찰

1. Local provider 연결 확인과 agent 시작 시 Side Panel 또는 설정 문서가 공통 helper의 무인증 `/models` probe로 Chrome의 Local Network Access 권한을 먼저 요청한다.
2. 사용자가 대상 탭에서 툴바 action을 클릭하면 background가 `chrome.sidePanel.open({ tabId })`로 tab-scoped panel을 열고 `activeTab` 권한을 획득한다.
3. Side Panel이 선발급한 `runId`, request-scoped attachment snapshot, `allowScreenshots`와 함께 `AGENT_RUN_REQUEST`를 보낸다.
4. Service Worker가 attachment 계약을 다시 검증하고 Chrome의 마지막 포커스 창에서 활성 탭을 확인한 뒤 실행을 탭 ID, 창 ID, 시작 URL에 고정한다.
5. Content Script가 `PAGE_OBSERVE`를 받아 구조화된 snapshot을 반환한다.
6. 최초 메시지는 DOM snapshot과 첨부만 포함한다. 화면 캡처가 허용된 요청에서만 모델이 시각 정보가 필요하거나 DOM 기반 진행이 막혔을 때 `capture_screen`으로 최신 visible viewport를 요청할 수 있다.
7. Provider에 전달할 snapshot의 현재 페이지 URL은 origin만 남기고 path, query, fragment를 제거한다. 내부 탭 고정과 UI 결과는 원본 URL을 유지한다.
8. 텍스트/PDF는 untrusted document block, 첨부 이미지와 화면 캡처는 multimodal image part로 구성한다.
9. ProviderClientRouter가 registry의 protocol에 따라 OpenAI-compatible client 또는 Anthropic native client로 전송한다.

### 긴 자막 요약

1. 에이전트는 영상 전체 요약 요청에서 재생 제어보다 `summarize_video_transcript`를 우선하며, 영상을 끝까지 재생하거나 종료를 기다리지 않는다. YouTube 데스크톱에서 열린 자막이 없으면 영상 설명 영역의 `더보기(More) → 스크립트 표시(Show transcript)`를 순서대로 선택해 영상 오른쪽 자막 패널을 연 뒤 재관찰한다.
2. `TranscriptSummaryService`는 pinned tab에 `TRANSCRIPT_READ_CHUNK`를 보내 최대 8,000자의 새로운 타임스탬프 구간과 직전 최대 2개 구간의 겹침 맥락을 읽는다.
3. 각 청크 원문은 메인 agent history와 분리된 provider 요청에서 요약한다. 자막과 중간 요약은 모두 untrusted data로 표시하고 내부 명령을 따르지 않는다.
4. 구간 요약이 6개를 넘으면 6개 단위의 장 요약으로 반복 압축한 뒤, 전체 요약·타임스탬프 목차·근거·결론을 생성한다.
5. 메인 에이전트에는 최종 압축 결과, 처리 청크 수, 시간 범위와 truncation 여부만 tool result로 반환한다. 최대 64청크와 기존 30분 run deadline, 사용자 취소 신호를 적용한다.

### 도구 실행

1. 모델 응답의 `tool_calls[].function.arguments`를 JSON으로 파싱한다.
2. 도구별 validator가 정확한 스키마를 검사한다.
3. SafetyPolicy가 차단, 승인 필요, 즉시 허용 중 하나를 반환한다.
4. 승인 필요 시 실행을 일시 정지하고 Side Panel에 요청 전체 승인 카드를 보낸다. 사용자가 승인하면 같은 `runId`의 후속 `confirm` 동작은 추가 카드 없이 허용하며, 완료·취소·안전 한도 종료 시 grant를 폐기한다. `deny` 동작에는 grant를 적용하지 않는다. 클릭·텍스트 입력·select·checked·내부 스크롤은 관찰 당시 요소 상태를 DOM guard로 함께 전달하고 Content Script가 실행 직전에 동기적으로 재검증한다.
5. 각 관찰·캡처·동작 전후에 탭 ID, 창 ID, URL을 확인하고 관찰 snapshot의 URL도 대조한다. 탭·창 전환과 예상하지 않은 navigation은 실행을 중단한다. 사용자 승인 후 실행한 클릭 또는 Enter는 다음 관찰까지 same-origin navigation 1회를 허용하고 pin URL을 갱신한다.
6. 클릭 또는 Enter를 실행하면 같은 모델 응답의 남은 tool call은 deferred 결과로 닫고 새 snapshot을 관찰한 뒤 다음 모델 단계에서 다시 판단한다. action 응답이 unload로 유실돼도 allowance는 이 관찰까지만 유지된다.
7. `capture_screen`은 사용자 허용, pinned tab/window/URL, Chrome rate limit, run당 6회 budget을 모두 만족할 때만 실행한다. 캡처 뒤 같은 응답의 남은 call은 deferred 처리한다.
8. 허용된 명령만 Content Script 또는 Chrome API로 전달한다. 대상의 가시성, 가림 여부, 의미, 선택·체크·스크롤 상태, 입력 메타데이터 또는 위치가 관찰 이후 바뀌면 실행하지 않고 새 snapshot에서 다시 판단한다.
9. 클릭·Enter·select·checked 뒤에는 최대 1.5초의 bounded DOM quiet period를 기다린다. 일반 페이지와 중첩 컨테이너 스크롤은 즉시 위치가 확정되는 auto behavior를 사용한다.
10. Content Script의 구조화된 action 오류와 retryable 여부를 보존해 모델이 stale·가림 오류만 새 관찰 후 재시도하게 한다. 실행 결과는 `role: tool` 메시지로 반환하며 캡처 결과 자체는 저장하지 않는다.

### 실행 종료

1. `AGENT_RUN_REQUEST`는 장시간 일회성 message 응답 채널을 유지하지 않고 실행 등록 직후 시작 확인을 반환한다. Side Panel은 transport-level 확인 유실 시 같은 `runId`로 1회 재전송하며, Service Worker는 accepted/running/terminal run을 멱등 처리해 중복 실행을 막는다.
2. Side Panel은 실행 중 20초 간격 heartbeat 요청으로 MV3 Service Worker의 유휴 종료를 방지한다. heartbeat는 활성 run, 최근 terminal event, 상태 유실을 구분해 event 유실과 Service Worker 재시작을 복구 가능한 오류로 종료한다.
3. 모델이 tool call 없는 최종 텍스트를 반환하면 background가 terminal event로 결과를 Side Panel에 전달하고, 최근 20개 결과를 heartbeat 복구용 메모리 캐시에 유지한다.
4. tool call과 trim된 텍스트가 모두 없는 응답은 history에 넣지 않고 명시적인 계속 요청을 추가한다. 연속 2회까지 재시도하고 세 번째 빈 응답은 `MODEL_PROTOCOL_ERROR` terminal event로 전달한다. Local agent 요청은 reasoning token이 출력 예산을 소진하지 않도록 `reasoning_effort: "none"`을 사용한다.
5. URL, viewport, 숫자형 시각 정보가 정규화된 visible text, 안정 element 속성, 안정 YouTube 상태와 tool call 묶음이 두 번째 반복되면 run당 한 번만 다른 안전한 접근 방식을 요청한다. 입력 text는 원문 대신 fingerprint로 비교한다.
6. 동일 전환이 세 번째에도 반복되거나 100단계 또는 30분 비상 한도에 도달하면 `safety_limit`으로 종료한다. 30분 deadline은 초기 관찰부터 모델·승인·도구 대기까지 전체 run의 `AbortController`에 적용한다.
7. 사용자의 중지 요청은 단계와 무관하게 동일한 `AbortController`로 진행 중 대기를 즉시 취소하며, terminal event 후 heartbeat와 UI 실행 상태를 정리한다.

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

esbuild는 Service Worker, Content Script, Side Panel, Settings 엔트리를 각각 분할 없는 독립 번들로 만든다. remote code를 사용하지 않고 모든 런타임 JavaScript와 CSS를 패키지에 포함한다. PDF.js worker와 packed CMaps도 `dist/vendor/pdfjs/`에 복사해 extension package 안에서만 로드한다.

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

전체 스크립트 탐색은 사이트별 selector나 추가 권한을 사용하지 않는다. shared prompt guidance는 최신 DOM snapshot에 이미 전체 스크립트가 있으면 이를 우선 사용한다. 없으면 YouTube 데스크톱에서 현지화된 `더보기(More) → 스크립트 표시(Show transcript)` 컨트롤을 정확한 일회성 element ID로 클릭하고, 영상 오른쪽에 패널이 열린 뒤 재관찰하도록 지시한다. 오른쪽 위치는 YouTube 데스크톱에만 적용하며 다른 사이트와 좁은 배치에서는 관찰 결과를 따른다. 관련 컨트롤을 최대 2회 조작으로 찾지 못하면 현재 관찰 데이터만 사용하고 한계를 알린다.

열린 전체 스크립트가 길면 전용 `TranscriptReader`가 최신 `transcript-segment-view-model`, 기존 `ytd-transcript-segment-renderer`, 명시적 `data-transcript-*` 구간만 cursor 기반으로 읽는다. 일반 `PAGE_OBSERVE`의 12,000자·현재 뷰포트 개인정보 경계를 넓히지 않으며, 일반 페이지 스크롤로 원문을 대화 이력에 누적하지 않는다. 사이트 DOM 변경으로 구조화된 열린 구간을 확인할 수 없으면 임의 selector를 추측하지 않고 unavailable 결과를 반환한다.

### ADR-007: 요청 메모리 기반 첨부 처리

첨부 원문은 Chrome storage, 로그, 채팅 HTML에 저장하지 않는다. Side Panel은 signature/MIME/크기/UTF-8을 먼저 검사하고 PDF.js로 plain text만 추출하며, Service Worker는 직렬화된 계약을 다시 검증한다. 첨부 내용은 모델 instruction이 아닌 untrusted data로 경계를 분리한다.

### ADR-008: 최상위 문서 관찰 우선

MVP의 DOM snapshot은 활성 탭의 최상위 문서와 일반 light DOM만 관찰한다. closed/open shadow root 내부와 cross-origin iframe 내부는 수집하지 않으며, iframe은 별도 frame 권한과 명시적 사용자 동의가 필요한 후속 범위로 둔다.
