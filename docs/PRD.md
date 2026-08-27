# Browser Agent Extension PRD

## 1. 목표

Chrome 사이드 패널에서 현재 탭을 관찰하고, 사용자의 명시적 요청에 따라 화면을 분석하거나 안전한 브라우저 조작을 수행하는 Manifest V3 확장 프로그램을 제공한다.

## 2. 기본 사용 흐름

1. 사용자가 확장 아이콘을 눌러 사이드 패널을 연다.
2. 로컬 LM Studio 또는 OpenAI 프로바이더를 선택하고 연결을 확인한다.
3. 사용자가 현재 화면 분석 또는 작업 지시를 입력한다.
4. 확장은 DOM 요약과 선택적 스크린샷을 모델에 전달한다.
5. 모델이 허용된 도구를 선택하면 확장은 안전 정책을 검사한 후 실행한다.
6. 위험 동작은 실행 전에 사용자가 승인한다.
7. 각 실행 결과를 다시 관찰하고 최종 결과와 실행 기록을 표시한다.

## 3. MVP 기능

### 3.1 화면 관찰 및 분석

- 활성 탭의 URL, 제목, 보이는 텍스트와 상호작용 요소를 구조화한다.
- 사용자가 요청할 때만 `chrome.tabs.captureVisibleTab()`으로 현재 보이는 영역을 캡처한다.
- DOM 관찰 결과와 PNG 데이터 URL을 비전 모델에 전달할 수 있다.
- 캡처 중임을 사이드 패널에 명확히 표시한다.

### 3.2 안전한 페이지 조작

- 관찰 결과가 발급한 일회성 element ID로 클릭한다.
- text, search, email, url, tel 입력 필드와 textarea에 텍스트를 입력한다.
- password, file, hidden 입력과 contenteditable 비밀번호 영역은 거부한다.
- 스크롤과 Enter/Escape/Tab/방향키 입력을 지원한다.
- 페이지가 변경되면 이전 element ID를 폐기한다.

### 3.3 YouTube 분석 및 제어

- YouTube 영상의 제목, URL, 현재 시간, 길이, 재생 상태, 속도, 볼륨을 읽는다.
- 재생, 일시 정지, 특정 시간 이동, 재생 속도 및 볼륨 변경을 지원한다.
- 현재 프레임은 탭 캡처로 분석한다.
- 페이지에서 자막 텍스트를 안전하게 얻을 수 있는 경우 분석 컨텍스트에 포함한다.
- 영상 전체 분석 요청에서는 관찰 결과에 이미 전체 스크립트가 있으면 컨트롤을 조작하지 않고 이를 우선 사용한다.
- 열린 전체 스크립트가 길면 타임스탬프 경계의 최대 8,000자 구간으로 나누고, 구간 요약을 6개 단위로 계층적으로 합쳐 전체 요약을 만든다.
- 최신 `transcript-segment-view-model`과 기존 YouTube 자막 구간을 모두 지원하며, 전체 영상 분석을 위해 영상을 끝까지 재생하거나 종료를 기다리지 않는다.
- 긴 자막 원문은 메인 에이전트 대화 기록에 누적하지 않으며, 최종 압축 결과에 분석한 시간 범위를 표시한다.
- 전체 스크립트가 보이지 않으면 에이전트는 YouTube 데스크톱 영상 설명 영역의 `더보기(More) → 스크립트 표시(Show transcript)`를 최대 2회 조작으로 탐색한다. 스크립트 표시 뒤 영상 오른쪽에 자막 패널이 열린다는 점을 분석 안내에 명시하고 페이지를 재관찰한다.
- 다른 영상 사이트 또는 좁은 화면에서는 오른쪽 패널 위치를 단정하지 않고 관찰된 Transcript/Script 컨트롤과 실제 배치를 따른다.
- 에이전트는 selector를 추측하거나 실패한 탐색을 반복하지 않으며, 전체 스크립트를 찾지 못하면 현재 자막·프레임만 분석했음을 알린다.
- 페이지를 변경하지 않는 화면 분석은 현재 자막과 전체 스크립트를 구분하고, 전체 스크립트가 관찰되지 않으면 열어야 할 컨트롤을 안내하되 직접 열었다고 주장하지 않는다.
- MVP는 현재 보이는 프레임을 분석하며, 구간별 자동 프레임 샘플링은 후속 범위로 둔다.

### 3.4 LLM 프로바이더

기본 로컬 설정:

- Base URL: `http://192.168.10.105:3620/v1`
- Model: `qwen/qwen3.8-27b`
- API key: 선택 사항

Cloud 및 custom 설정:

- OpenAI: `https://api.openai.com/v1`
- Anthropic: `https://api.anthropic.com` native Messages API
- OpenRouter: `https://openrouter.ai/api/v1`
- Groq: `https://api.groq.com/openai/v1`
- Together AI: `https://api.together.xyz/v1`
- DeepSeek: `https://api.deepseek.com`
- Mistral: `https://api.mistral.ai/v1`
- xAI: `https://api.x.ai/v1`
- Custom: 사용자가 승인한 HTTPS OpenAI-compatible Base URL
- Model: provider별 기본값 또는 사용자가 입력한 model ID
- API key: 세션 저장이 기본이며 영구 저장은 명시적 선택

Local, OpenAI, OpenRouter, Groq, Together AI, DeepSeek, Mistral, xAI, Custom은 OpenAI-compatible `POST /chat/completions`를 사용한다. Anthropic은 native `POST /v1/messages`를 사용하며 내부 공통 message/tool 형식으로 변환한다. Custom provider는 설정 저장 시 해당 HTTPS origin의 optional host permission을 사용자에게 요청한다.

### 3.5 통합 적응형 에이전트

- 화면 분석과 에이전트 실행을 하나의 메시지 전송 기능으로 통합한다.
- 모델은 사용자 메시지에 따라 현재 관찰과 첨부만으로 답변하거나, 내부 계획을 세우고 필요한 브라우저 도구를 실행한다.
- DOM 정보가 부족하거나 진행이 막혔을 때만 사용자가 허용한 `capture_screen`으로 현재 viewport를 분석하며, 요청 시작 시 자동 캡처하지 않는다.
- 같은 전환이 반복되면 1회 bounded re-planning 기회를 제공하고, 계속 정체되면 기존 안전 한도에서 중단한다.
- 모델이 최종 텍스트 답변을 반환할 때까지 관찰, 모델 결정, 정책 검사, 도구 실행, 결과 기록을 반복한다.
- tool call과 최종 텍스트가 모두 없는 응답은 완료로 표시하지 않는다. 빈 assistant turn을 기록하지 않고 최대 2회 작업 계속을 요청하며, 반복되면 모델 protocol 오류로 종료한다.
- Local provider agent 요청은 reasoning을 비활성화해 token 예산을 tool call 또는 최종 답변에 사용한다.
- 장시간 실행은 시작 요청에 즉시 응답하고 heartbeat로 Service Worker를 유지하며, 최종 결과는 별도 terminal event로 전달한다. terminal event가 유실되면 heartbeat로 결과를 복구하고 Service Worker가 실행 상태를 잃으면 명확히 안내하고 종료한다.
- 사용자는 언제든 실행을 중단할 수 있다.
- 동일한 페이지 상태와 동일한 동작 묶음이 3회 반복되면 정체로 판단해 중단한다.
- 비상 안전장치로 100단계 또는 30분에 도달하면 실행을 중단한다.
- 같은 실패 동작을 반복하지 않도록 도구명과 인자를 기록한다.
- 상세 통합 계약과 마이그레이션 범위는 `UNIFIED_AGENT_DESIGN.md`를 따른다.

### 3.6 대화형 결과 표시

- 사용자 요청과 에이전트 응답을 시간순 채팅 말풍선으로 구분한다.
- 헤더 상태는 준비, 생각 중, 승인 대기, 응답 완료, 중지, 오류를 명시한다.
- 모델의 Markdown 형식 응답은 원시 HTML 없이 제목, 문단, 목록, 강조, 코드로 표시한다.
- 진행 이벤트는 새 로그를 누적하지 않고 현재 응답 말풍선의 상태를 갱신한다.
- 완료되거나 중지된 에이전트 답변은 원문 복사와 사용자 주도 공유를 제공한다.
- Web Share API를 지원하지 않는 환경의 공유 동작은 클립보드 복사로 대체하고 결과를 알린다.
- 새 메시지가 추가되면 대화 영역의 최신 메시지를 보여 준다.

### 3.7 자율 화면 캡처와 첨부파일

- 사용자가 요청 단위 화면 캡처를 허용하면 agent가 현재 보이는 viewport의 새 screenshot을 모델 tool로 요청할 수 있다.
- screenshot tool은 pinned tab 검증, Chrome capture rate 제한, run당 6회 제한, 기존 취소·시간·단계 안전 한도를 적용한다.
- 사용자는 요청당 최대 5개의 PNG, JPEG, WebP, GIF, 텍스트 계열 파일 또는 PDF를 첨부할 수 있다.
- 이미지 파일은 provider multimodal 입력으로, 텍스트와 PDF는 브라우저에서 추출한 제한된 plain text로 전달한다.
- 첨부파일은 요청 메모리에만 유지하며 저장소, 로그, HTML 렌더링에 원문을 남기지 않는다.
- 파일 형식·크기·MIME와 runtime message를 UI와 Service Worker 양쪽에서 검증한다.
- 상세 형식, 제한, 보안 경계는 `CAPTURE_AND_ATTACHMENTS_DESIGN.md`를 따른다.

## 4. 위험 동작 승인

다음 동작은 요청에서 처음 필요할 때 승인 카드로 표시한다. 사용자가 `이 요청 모두 승인`을 선택하면 같은 요청의 후속 승인 대상 동작은 추가 카드 없이 실행하며, 요청 완료·취소·안전 한도 종료 시 승인을 폐기한다.

- 폼 제출 또는 Enter로 제출될 가능성이 있는 입력
- 메시지, 댓글, 이메일 전송
- 구매, 결제, 주문, 송금
- 삭제, 구독 취소, 로그아웃
- 로그인 또는 계정 설정 변경
- 외부 사이트 이동 및 다운로드

비밀번호, 결제 카드 번호, 인증 코드 입력은 MVP에서 지원하지 않으며 요청 전체 승인으로도 허용되지 않는다.

입력 필드의 `autocomplete` 메타데이터가 `one-time-code`, password 또는 결제 카드 계열이면 라벨과 `type`이 평범해도 차단한다. 승인된 요소는 실행 직전에 관찰 당시 DOM 상태와 다시 비교하며 숨김·이동·가림·이름·역할·선택·체크·스크롤·입력 메타데이터 변경이 있으면 실행하지 않는다. 일반 페이지 텍스트에서는 입력 요소, 편집 중인 `contenteditable` 초안과 현재 뷰포트 밖 텍스트를 제외한다. Select는 내부 value 없이 표시 라벨만, checkbox/radio는 문자열 value 없이 boolean 상태만 구조화한다.

## 5. 제외 범위

- 브라우저 주소창, 개발자 도구, 다른 확장 프로그램 UI 조작
- 숨겨진 탭 또는 다른 창의 지속적 녹화
- 영상·음원 다운로드 또는 DRM 우회
- 임의 JavaScript, 임의 CSS selector, 셸 명령 실행
- CAPTCHA 해결 또는 사이트 보안 우회
- 브라우저 전체를 무인 자동화하는 장시간 작업

## 6. 기술 제약

- Chrome 116 이상을 목표로 한다.
- `captureVisibleTab()`은 현재 보이는 탭만 캡처하고 초당 최대 2회 호출한다.
- Chrome 내부 페이지와 Chrome Web Store 등에는 content script를 주입할 수 없다.
- 로컬 HTTP API 통신은 암호화되지 않으므로 신뢰할 수 있는 LAN에서만 사용한다.
- DRM 또는 보호된 영상은 캡처 결과가 검게 나올 수 있다.
- 스캔 PDF OCR, Office 문서, archive, audio/video 첨부는 이번 범위에서 지원하지 않는다.

## 7. 수용 기준

- unpacked extension으로 오류 없이 로드된다.
- 기본 로컬 프로바이더에서 모델 목록 및 채팅 연결 검사가 성공한다.
- OpenAI, Anthropic, OpenRouter, Groq, Together AI, DeepSeek, Mistral, xAI와 HTTPS OpenAI-compatible custom 프로바이더를 선택하고 설정할 수 있다.
- 일반 웹 페이지에서 하나의 메시지 기능으로 직접 답변, 능동적 화면 분석, 클릭, 안전한 텍스트 입력, select·checkbox/radio 변경, 페이지·중첩 컨테이너 스크롤이 동작한다.
- 가려진 요소는 관찰·실행에서 제외하고, 클릭·Enter·폼 상태 변경 뒤 bounded DOM quiet period 후 새 화면을 재관찰한다.
- 승인된 클릭·Enter로 발생한 same-origin navigation 이후 새 페이지를 재관찰해 복합 작업을 계속하며, 재관찰 전에는 같은 모델 응답의 남은 도구를 실행하지 않는다.
- Provider에는 현재 페이지 URL의 origin만 전달하고 path, query, fragment는 제외한다.
- 화면 캡처 권한이 만료되면 대상 탭에서 toolbar action을 다시 클릭하도록 안내한다.
- Local provider 통합 요청은 Side Panel에서 Local Network Access probe를 먼저 수행하고, Service Worker 요청도 실패할 때 권한과 서버 상태를 함께 안내한다.
- Local reasoning 모델의 통합 agent 요청은 reasoning을 비활성화해 token 예산을 tool call 또는 최종 답변에 사용한다.
- YouTube에서 상태 읽기와 재생 제어가 동작한다.
- 열린 긴 영상 자막을 구간별로 처리해 타임스탬프 목차가 있는 전체 요약을 만들고 진행 중 취소할 수 있다.
- 모델이 tool call을 반환하면 완료까지 정책을 준수해 실행하고, 빈 응답은 최대 2회 복구한 뒤 protocol 오류로 종료하며, 정체·100단계·30분 안전 한도에서 중단한다.
- 5분을 넘는 agent 실행도 초기 runtime message 채널 종료로 최종 결과를 유실하지 않는다.
- 위험 동작과 비밀번호 입력이 차단된다.
- API 키와 화면 데이터가 로그에 출력되지 않는다.
- 사용자 요청, 진행 상태, 최종 답변이 채팅 형식으로 구분되고 완료 여부를 즉시 알 수 있다.
- 완료·중지된 답변을 복사하거나 네이티브 공유 시트로 전달할 수 있고 성공·취소·실패 상태를 알 수 있다.
- 사용자가 허용한 run에서 모델이 필요하거나 진행이 막혔을 때 새 viewport screenshot을 요청할 수 있고, 허용하지 않은 run에서는 capture tool을 사용할 수 없다.
- 지원되는 이미지·텍스트·PDF 첨부를 Local/OpenAI-compatible/Anthropic에서 읽을 수 있으며, 지원하지 않거나 제한을 넘는 파일은 provider 전송 전에 거부한다.
- 포맷, 린트, 타입 검사, 단위 테스트, 빌드 및 브라우저 QA를 통과한다.
