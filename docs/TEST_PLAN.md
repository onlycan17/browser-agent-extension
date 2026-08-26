# Browser Agent Extension Test Plan

최신 실행 결과와 정적 Side Panel 브라우저 증거는 `docs/VERIFICATION.md`에 기록한다.

## 1. 정적 검사

- Prettier format check
- ESLint with zero warnings
- TypeScript `tsc --noEmit`
- V8 coverage: statements/functions/lines 80% 이상, branches 70% 이상(현재 baseline 보호)
- production build
- forbidden pattern scan: `eval`, `new Function`, `as any`, TypeScript suppression comments, hardcoded secret patterns
- `npm audit`

## 2. 단위 테스트

### Settings

- 10개 provider registry, 기본 Base URL/model/protocol/timeout
- 고정 origin과 Custom HTTPS URL 정규화 검증
- legacy max steps 필드 제거 migration 검증
- API key 마스킹, provider/origin scope 저장, provider 및 Custom origin 변경 시 제거
- 누락·손상 설정 fallback과 scope 없는 legacy key 제거
- Custom optional host permission 요청·거부·이전 origin 제거·저장 실패 rollback
- Side Panel·설정 화면 공통 Local Network Access probe, 실행 순서, 응답 정리, 차단 안내

### LLM protocol

- 텍스트 및 image URL 메시지 생성
- 정상 tool call 파싱
- OpenAI-compatible explicit null과 Anthropic empty/reasoning-only turn의 recovery용 정규화
- content 누락·잘못된 JSON arguments 등 malformed 응답 거부
- 알 수 없는 tool과 추가 속성 거부
- 성공 상태의 non-JSON body를 protocol 오류로 분류
- provider HTTP 상태 및 Local 480초/OpenAI 45초/기타 Cloud 120초 timeout 오류 변환
- OpenAI-compatible `/models`와 `/chat/completions` 요청
- Anthropic `/v1/models`, `/v1/messages` header와 system/image/tool 양방향 변환
- provider router의 native/compatible client 분기

### Attachments

- strict image/text attachment union과 runtime 재검증
- 요청당 5개, 이미지/텍스트/PDF별 크기, 전체 10MB, 추출 텍스트 64,000자 제한
- filename traversal/control character, MIME/확장자, image signature/data URL decoded size 불일치 거부
- UTF-8 decoding, 파일당 32,000자 truncation, PDF page-order plain text extraction
- corrupt/password/scanned PDF의 원문 미노출 오류와 raw PDF bytes provider 전송 금지
- request-scoped add/remove/snapshot/clear 상태

### Side Panel chat renderer

- 사용자와 에이전트 말풍선 역할 구분
- 생각 중, 응답 완료, 중지, 오류 상태 라벨 갱신
- 첫 승인 후 같은 run의 후속 confirm 자동 승인, 거부·만료·완료·취소 시 grant 격리
- 응답 갱신 시 하단 자동 스크롤과 사용자의 이전 메시지 탐색 위치 보존
- 제목, 목록, 강조, 인라인 코드의 안전한 Markdown 형식 렌더링
- 모델이 반환한 HTML 문자열을 실행 가능한 DOM으로 삽입하지 않음
- 진행 중 답변에는 액션을 숨기고 완료·중지된 에이전트 답변에만 복사·공유 노출
- 진행 메시지가 최종 답변으로 갱신된 뒤 복사·공유가 최신 원문을 사용
- Clipboard/Web Share 성공, 네이티브 공유 미지원 fallback, 사용자 취소, API 실패 안내

### Safety policy

- 일반 관찰과 YouTube 제어 허용
- password/file/hidden 입력 차단
- 모든 클릭과 submit, purchase, delete, login 동작 승인 요구
- stale generation 차단

### Agent runner

- 텍스트 응답 종료
- tool call → tool result → 최종 응답 반복
- whitespace 또는 null text와 빈 tool call 배열 복구, 빈 assistant history 제외, 연속 2회 재시도 경계와 tool call 후 counter reset, 세 번째 빈 응답의 protocol 오류
- Local agent의 reasoning 비활성화와 Anthropic 등 다른 provider 요청의 설정 미변경
- 12단계를 넘는 작업의 정상 완료
- 동일 페이지·동작 2회 반복 시 1회 bounded re-planning, 3회 반복 정체 종료와 동적 숫자·bounds·재생 시간 잡음 무시
- 서로 다른 text 입력 fingerprint를 진행으로 구분
- 100단계와 단계 사이·진행 중 모델 호출의 30분 비상 안전 한도 종료
- agent 시작 요청 즉시 확인, transport 확인 유실 시 같은 runId 재시도와 background 멱등 deduplication
- 실행 중 heartbeat, terminal success/error event로 최종 결과 전달
- heartbeat 중첩 방지, 유실된 terminal event 복구, Service Worker run 상태 유실 시 UI 종료
- 실행 등록 전, provider 요청 시작 전, provider 요청·도구 실행 진행 중 사용자 취소
- 안전 한도 종료 후 요청 전체 승인 grant 폐기
- 동일 실패 도구 반복 방지
- 요청 전체 승인 카드와 승인/거부 처리, 후속 confirm 카드 미노출
- `allowScreenshots`가 false면 `capture_screen` 미노출, true면 노출
- consent만으로 초기 캡처하지 않음, on-demand run당 6회, fresh capture 뒤 남은 call deferred와 새 image 재판단
- transient capture 실패 후 다음 모델 단계 재시도와 deterministic budget 실패 반복 차단
- text/image attachment initial message 전달과 screenshot consent 독립성

### Content logic

- 보이는 element만 관찰
- 현재 뷰포트 텍스트만 관찰하고 입력 요소·contenteditable 초안·화면 밖 텍스트 제외
- 모든 입력값 제거, autocomplete 메타데이터만 전달, 링크 origin 최소화
- element registry 세대 교체
- 관찰 이후 이름·역할·위치·가시성·입력 메타데이터가 바뀐 요소의 실행 직전 거부
- React-style input setter와 input/change event
- 텍스트 입력 focus와 승인된 Enter의 실제 form requestSubmit
- YouTube state validation and command bounds

## 3. 통합 테스트

- toolbar action 클릭으로 tab-scoped Side Panel 열기와 activeTab 접근 안내
- mock Chrome API로 Side Panel ↔ Service Worker 메시지 왕복
- mock content port로 observe/action 흐름
- mock LLM server로 tool call 전체 사이클
- Local agent는 `reasoning_effort: "none"`, Cloud agent 요청은 기존 설정 유지
- 실제 로컬 `/v1/models` 연결 검사는 별도 network test로 분리
- Cloud client protocol은 mock key로 검사하고, router가 key 누락을 네트워크 요청 전에 거부하는지 확인하며 실제 key 검사는 수동 QA로 분리
- 통합 agent 요청의 attachment runtime validator, untrusted text/PDF 경계, multimodal image 전달
- PDF.js worker와 CMaps의 production package 생성 및 non-empty build 검증

## 4. 브라우저 QA

### 일반 페이지

- unpacked extension 로드
- side panel 열기
- Local 및 사용 가능한 Cloud provider 연결 검사
- Custom HTTPS origin 권한 승인·거부와 provider 전환 권한 정리
- 단일 `보내기` 동작의 tool 없는 현재 화면 답변
- 화면 캡처 API 거부 시 toolbar action 재클릭 안내
- Local provider agent 시작 전 document-context Local Network Access probe와 이중 실패 안내
- Local reasoning 모델이 빈 content 대신 최종 응답을 반환하는지 확인
- 입력 필드 값 설정
- 버튼 클릭과 스크롤
- stale element 오류 후 재관찰
- 승인된 클릭·Enter의 same-origin navigation 후 pin URL 갱신과 새 페이지 재관찰
- 클릭·Enter 또는 unload 응답 실패 뒤 같은 batch의 남은 도구를 deferred 처리하고 새 snapshot 전에는 실행하지 않는지 확인
- 탭·창 전환, cross-origin 이동, 비-navigation 동작 중 URL 변경, allowance 소진 후 navigation 중단
- agent provider 요청의 현재 페이지 URL이 origin만 포함하고 path, query, fragment를 제외하는지 확인
- picker keyboard 접근, chip 제거, truncation/error/live status, 실행 중 disabled, 성공 후 clear와 실패 후 retry 유지
- PNG/JPEG/WebP/GIF, TXT/Markdown/CSV/JSON/HTML/XML, text PDF를 Local provider에서 분석
- 스캔·손상·암호 PDF, 잘못된 MIME/signature, 개수·크기 초과가 provider 전송 전에 거부되는지 확인
- 스크롤 전후 모델의 자율 캡처가 visible viewport를 갱신하고 6회 budget을 넘지 않는지 확인

### YouTube

- 영상 상태 표시
- play/pause
- seek, speed, volume 경계값
- 현재 프레임 분석
- 관찰 결과에 이미 전체 스크립트가 있으면 컨트롤 조작보다 우선 사용
- YouTube `More > Show transcript`와 다른 영상 사이트의 현지화된 Transcript/Script 버튼 탐색 안내
- transcript 탐색은 최대 2회 조작으로 제한하고, 메뉴 클릭 후 최신 snapshot 재관찰, selector 추측·반복 탐색 금지
- 직접 답변에서 현재 자막과 전체 스크립트를 구분하고, 부재 시 fallback을 안내하되 컨트롤을 열었다고 주장하지 않음

### 보안

- password 입력 차단
- 첫 submit 동작의 요청 전체 승인 카드와 같은 run 후속 confirm 자동 실행
- 승인 후에도 password/payment/OTP deny 유지
- 평범한 라벨의 `autocomplete=one-time-code`/password/결제 카드 필드 차단
- 승인 대기 중 숨김·이동·이름 변경된 대상 실행 차단
- 편집 초안과 화면 밖 텍스트가 provider snapshot에 포함되지 않는지 확인
- 승인 거부 후 실행 중단
- Chrome 내부 페이지의 명확한 unsupported 안내
- API key, screenshot, attachment 원문이 console이나 Chrome storage에 없는지 확인

## 5. 뷰포트

- Side Panel width 320px
- Side Panel width 480px
- high contrast and keyboard-only navigation
