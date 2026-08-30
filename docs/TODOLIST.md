# Browser Agent Extension Implementation Checklist

## A. 설계 및 기반

### A-1. 문서

- [x] 제품 범위와 수용 기준 정의
- [x] 런타임 구성과 데이터 흐름 정의
- [x] 내부 메시지 및 LLM API 계약 정의
- [x] 보안 모델과 승인 정책 정의
- [x] 테스트 계획 정의

### A-2. 프로젝트 구성

- [x] npm 프로젝트와 정확한 의존성 버전 정의
- [x] TypeScript strict 설정
- [x] esbuild 독립 엔트리 build 설정
- [x] Vitest, ESLint, Prettier 설정
- [x] Manifest V3와 최소 권한 선언
- [x] build 산출물 구조 검증
- [x] 기반 정적 검사와 smoke test 통과

## B. 설정과 프로바이더

### B-1. 설정 모델

- [x] local 기본 설정 상수 정의
- [x] provider 설정 runtime validator 구현
- [x] base URL 정규화와 allowlist 구현
- [x] legacy max agent steps 필드 제거 migration 검증
- [x] 설정 모델 단위 테스트

### B-2. 안전한 저장

- [x] 공개 설정과 secret 분리
- [x] session API key 저장 구현
- [x] 명시적 local 영구 저장 구현
- [x] trusted contexts 접근 제한
- [x] API key 비반환·비로그 테스트
- [x] provider 변경 시 기존 API key 제거

### B-3. OpenAI 호환 클라이언트

- [x] `/models` 단순 GET 연결 검사와 private-network preflight 회피
- [x] `/chat/completions` 텍스트 요청
- [x] image URL 요청
- [x] tool schema 및 tool result 요청
- [x] Local 480초/OpenAI 45초 timeout, abort, HTTP 오류 매핑
- [x] mock fetch 단위 테스트
- [x] 로컬 LM Studio network test

### B-4. Multi-provider registry

- [x] provider registry와 기존 local/openai 설정 마이그레이션
- [x] Anthropic, OpenRouter, Custom provider defaults와 validation
- [x] provider별 timeout 정의
- [x] provider별 API key 안내
- [x] Custom HTTPS Base URL 및 optional origin permission
- [x] provider 변경 시 API key와 이전 custom origin permission 정리

### B-5. Anthropic native client

- [x] Messages API header와 request adapter
- [x] system, text, base64 image message 변환
- [x] tool definition, tool_use, tool_result 변환
- [x] model 목록과 response/error parser
- [x] abort, timeout, malformed response 테스트

### B-6. Provider routing과 설정 UI

- [x] OpenRouter 및 Custom OpenAI-compatible routing
- [x] Anthropic/OpenRouter/Custom provider 선택 UI
- [x] Custom Base URL editable 상태와 보안 안내
- [x] provider별 연결 검사와 model availability 표시
- [x] 기존 Local/OpenAI 전체 회귀 테스트

## C. Side Panel

- [x] 사용자/에이전트 채팅 말풍선과 시간순 대화 흐름
- [x] 생각 중/승인 대기/응답 완료/중지/오류 상태 표시
- [x] 승인 거부/만료와 이전 실행의 늦은 승인 응답 격리
- [x] 최신 응답 자동 스크롤과 사용자 스크롤 위치 보존
- [x] 원시 HTML 없는 안전한 Markdown 형식 렌더링
- [x] 완료·중지된 답변 복사와 네이티브 공유, 미지원 환경 복사 fallback

### C-1. 정보 구조

- [x] 헤더와 연결 상태
- [x] 대화 및 실행 로그 영역
- [x] prompt 입력과 화면 포함 옵션
- [x] 통합 `보내기`와 실행 중 `중지` 버튼
- [x] 승인 요청 카드
- [x] 설정 drawer 또는 settings page 연결

### C-2. 접근성과 상태

- [x] 키보드 탐색과 visible focus
- [x] live region 상태 알림
- [x] 답변 복사·공유 성공, 취소, 실패의 시각적·스크린리더 피드백
- [x] loading, error, empty 상태
- [x] 320px 및 480px 레이아웃
- [x] side panel UI 단위 테스트

### C-3. 런타임 메시지

- [x] request ID 생성
- [x] message validator
- [x] success/error envelope
- [x] 알 수 없는 message 거부
- [x] Side Panel ↔ Service Worker 통합 테스트

## D. 페이지 관찰

### D-1. Content Script 연결

- [x] toolbar action 클릭 기반 activeTab 부여, tab-scoped Side Panel 열기, last-focused window 조회
- [x] 이미 주입된 script 재사용
- [x] restricted URL 사전 검사
- [x] unsupported page 오류 안내
- [x] 메시지 연결 테스트

### D-2. DOM snapshot

- [x] viewport와 document metadata 수집
- [x] visible text 길이 제한 수집
- [x] 상호작용 요소 역할·이름 계산
- [x] viewport bounds와 disabled 상태 수집
- [x] 모든 입력 필드 값 제외
- [x] 링크 URL을 origin으로 최소화
- [x] shadow DOM과 iframe 제한 문서화
- [x] DOM fixture 단위 테스트

### D-3. Element registry

- [x] 관찰 세대와 ID 발급
- [x] generation 범위 element Map
- [x] navigation/mutation 후 stale 처리
- [x] element 수 상한
- [x] stale generation 테스트

### D-4. 화면 캡처

- [x] PNG visible tab capture
- [x] 사용자 요청 기반 캡처 조건
- [x] capture rate guard
- [x] data URL 저장 금지
- [x] 캡처 오류 매핑 테스트
- [x] Chrome 캡처 거부 시 toolbar action 재클릭 안내
- [x] 화면 분석 전 document-context Local Network Access probe
- [x] document와 Service Worker 이중 연결 실패 안내
- [x] Local 화면 분석 reasoning 비활성화와 빈 content 회귀 테스트

## E. 페이지 동작

### E-1. 클릭

- [x] element ID 및 generation 검증
- [x] visibility와 disabled 재검사
- [x] 관찰 상태 DOM guard와 실행 직전 변경·숨김·이동 재검증
- [x] scroll into view
- [x] 모든 click 사용자 승인
- [x] 클릭 결과 테스트

### E-2. 텍스트 입력

- [x] 허용 input type 검사
- [x] password/file/hidden 차단
- [x] native value setter 적용
- [x] input/change 이벤트 발생
- [x] 입력 대상 focus
- [x] contenteditable 안전 입력
- [x] 입력 교체/추가 모드
- [x] React-style input fixture 테스트

### E-3. 키와 스크롤

- [x] 허용 키 allowlist
- [x] Enter 제출 위험 분류
- [x] focus된 폼 입력에서 승인된 Enter의 실제 requestSubmit
- [x] 스크롤 방향과 크기 제한
- [x] action 결과 테스트

## F. 안전 정책

### F-1. 분류

- [x] allow/confirm/deny 결과 모델
- [x] element 의미 기반 위험 키워드 분류
- [x] password/payment/OTP 차단
- [x] one-time-code/password/결제 카드 autocomplete 차단
- [x] submit/send/purchase/delete/login 승인 요구
- [x] 외부 navigation/download 승인 요구
- [x] 한국어·영어 위험 레이블 테스트

### F-2. 승인 흐름

- [x] approval ID와 만료 시간
- [x] Side Panel 승인 카드
- [x] 첫 승인 후 같은 run의 후속 confirm 자동 승인
- [x] run 완료·취소 시 요청 전체 승인 grant 폐기
- [x] 요청 전체 승인 후에도 deny 정책 유지
- [x] 거부와 timeout 후 실행 중단
- [x] 승인 상태 통합 테스트

## G. 에이전트

### G-1. Tool registry

- [x] 각 단계 자동 page observation
- [x] 선택적 초기 screen capture
- [x] click_element
- [x] type_text
- [x] press_key
- [x] scroll_page
- [x] youtube_control
- [x] 엄격한 arguments validator
- [x] 알 수 없는 tool 거부 테스트

### G-2. Agent runner

- [x] 시스템 prompt와 페이지 데이터 경계
- [x] 관찰 → 모델 → 정책 → 실행 반복
- [x] role tool 결과 연결
- [x] 모델 최종 답변까지 완료 중심 실행
- [x] 안정 page/action fingerprint와 서로 다른 동작의 불변 페이지 상태 기반 3회 정체 감지
- [x] 전체 run에 적용되는 100단계·30분 비상 안전 한도
- [x] provider 요청 시작 전·진행 중 AbortController 취소와 listener/timer 정리
- [x] Side Panel 선발급 run ID로 즉시 취소 race 방지
- [x] 실행 시작 탭·창·URL 고정 및 메시지 전후 탭 전환/navigation 시 중단
- [x] 승인된 클릭·Enter의 bounded same-origin navigation 후 pin 갱신
- [x] navigation-capable action 뒤 남은 tool call deferred 처리와 강제 재관찰
- [x] action unload 응답 실패 뒤 one-shot navigation recovery
- [x] provider-bound 현재 페이지 URL origin 최소화
- [x] navigation allowance 소진과 탭·창·origin 경계 회귀 테스트
- [x] 동일 실패 동작 반복 방지
- [x] Local agent reasoning token 비활성화
- [x] 빈 assistant turn 제외와 최대 2회 bounded recovery
- [x] 반복 빈 응답의 MODEL_PROTOCOL_ERROR terminal failure
- [x] 재시작 시 안전 취소 정책
- [x] 정상·실패·빈 응답 복구·진행 중 취소·동적 페이지 정체·비상 한도 테스트

### G-3. 진행 상태

- [x] 단계별 상태 이벤트
- [x] 실행 로그 redaction
- [x] 서비스 워커 재시작 시 안전한 종료
- [x] 최종 응답과 부분 실패 안내

## H. YouTube

### H-1. 상태 읽기

- [x] youtube.com watch 페이지 감지
- [x] video element 탐색
- [x] 제목, URL, 시간, 길이 확인 여부, 실시간 여부, 상태 수집
- [x] 속도와 볼륨 수집
- [x] video 부재/광고 상태 오류 처리

### H-2. 제어

- [x] play/pause
- [x] seek 0~duration 제한
- [x] volume 0~1 제한
- [x] playbackRate 허용 범위 제한
- [x] YouTube adapter 단위 테스트

### H-3. 분석

- [x] 현재 프레임 캡처와 시간 정보 결합
- [x] 사용 가능한 현재 자막 텍스트 수집
- [x] 자막 부재 시 텍스트 없는 상태 제공
- [x] 이미 관찰된 전체 스크립트 우선 사용
- [x] YouTube와 일반 영상 사이트의 현지화된 전체 스크립트 컨트롤 탐색 prompt
- [x] 관찰 우선 `스크립트 표시` 또는 `더보기 → 스크립트 표시` 힌트와 고정 패널 위치 가정 제거
- [x] 최신 `transcript-segment-view-model` 자막 구간 지원과 전체 영상 재생 완료 대기 금지
- [x] selector 추측·반복 탐색 방지와 비대화형 분석의 조작 주장 없는 fallback
- [x] 열린 전체 자막의 cursor·안정 segment key 기반 8,000자 청크 읽기, 비인접 중복 제거, 종료 재확인
- [x] 구간 요약 → 6개 단위 장 요약 → 전체 타임스탬프 요약 계층 처리
- [x] 자막 원문의 메인 agent history 누적 방지와 64청크·취소 안전 한도
- [ ] 제한된 구간 프레임 샘플 계획 (후속 범위)
- [x] capture rate와 사용자 취소 적용

## I. 자율 화면 캡처와 첨부파일

### I-1. 설계와 데이터 계약

- [x] provider-neutral 범위, 제한, 개인정보 경계 설계
- [x] attachment strict type과 runtime validator
- [x] 이미지·텍스트·PDF의 untrusted prompt 변환
- [x] PDF.js worker/CMap 로컬 번들 구성

### I-2. Side Panel 첨부 UX

- [x] 접근 가능한 파일 선택 버튼과 native input
- [x] 파일 chip, 제거, 크기·형식·추출 오류 표시
- [x] 요청 중 disabled 상태와 요청 수락 후 메모리 정리
- [x] 320px·480px 반응형 및 keyboard/screen reader 검증

### I-3. Agent 자율 캡처

- [x] request-scoped `allowScreenshots` 계약
- [x] `capture_screen` tool과 run당 6회 budget
- [x] pinned tab·rate limit·취소·timeout 적용
- [x] capture 이후 남은 call deferred 및 provider-safe 페이지 관찰과 fresh image의 단일 multimodal message 전달

### I-4. 첨부 통합

- [x] page analysis attachment 전달
- [x] agent initial message attachment 전달
- [x] OpenAI-compatible·Anthropic·Local serializer 회귀
- [x] text/PDF truncation 및 corrupt/password/scanned PDF 오류

## J. 완료 검증

### J-1. 자동 검사

- [x] format check
- [x] ESLint zero warnings
- [x] TypeScript zero errors
- [x] 전체 Vitest 통과
- [x] production build 통과
- [x] npm audit 확인
- [x] 금지 패턴과 secret scan
- [x] remote script 참조 부재 확인

### J-2. Chrome QA

- [x] 현재 `dist/` unpacked load 재검증
- [x] 현재 사이드 패널 extension page 재검증
- [x] 현재 Local 모델 attachment/capture 및 tool-call 응답 재검증
- [x] 현재 Side Panel·설정 화면 Chrome Local Network Access 권한 probe 재검증
- [x] 실제 탭 화면 분석 수동 확인
- [ ] 일반 페이지 관찰·입력·클릭·스크롤 수동 확인
- [x] 위험 동작 승인·거부 수동 확인
- [x] YouTube 상태·제어·프레임 분석 수동 확인
- [x] 취소와 정체·100단계·30분 안전 한도 자동 테스트
- [x] 장시간 실행 시작 확인·heartbeat·terminal event 전환 및 회귀 테스트
- [ ] 현재 unpacked extension context의 console error 부재
- [x] 정적 Side Panel 320px, 480px 무가로스크롤 및 필수 컨트롤

### J-3. 문서 동기화

- [x] README 설치·로드·사용법
- [x] 권한과 개인정보 안내
- [x] 알려진 제한 사항
- [x] 실제 명령과 테스트 결과 반영
- [x] 완료 항목 체크

## K. 통합 적응형 에이전트

### K-1. 설계와 계약

- [x] 현재 화면 분석·agent 분리 흐름 조사
- [x] 통합 UX, on-demand capture, bounded re-planning 설계
- [x] 사용자 구현 계획 확인
- [x] `PAGE_ANALYZE_REQUEST`와 `PageAnalysisResult` 제거
- [x] `PageAnalysisService`와 analysis dependency 제거
- [x] API·architecture·capture 문서의 단일 agent 계약 동기화

### K-2. Side Panel 통합

- [x] `화면 분석` 버튼과 analysis 전용 상태 제거
- [x] 하나의 `보내기` submit 및 통합 busy/stop 상태
- [x] 중립적인 시작·완료·실패 문구 적용
- [x] agent 시작 전 Local Network Access probe 연결
- [x] 첨부 선택·성공 후 clear·실패 후 retry 상태 보존

### K-3. Agent 적응 동작

- [x] 정보 요청의 tool 없는 직접 답변
- [x] 요청 복잡도에 비례한 계획 수립 (`create_plan`/`update_plan` 도구와 단계별 진행 추적)
- [x] initial screenshot 제거와 on-demand `capture_screen`
- [x] action 후 fresh DOM 재관찰 유지
- [x] 두 번째 반복 전환에서 1회 bounded re-planning
- [x] 계속된 정체의 기존 safety-limit 종료 유지
- [x] approval·cancel·timeout·tab pinning·heartbeat 회귀

### K-4. 검증

- [x] analysis 계약·서비스 테스트 제거 및 agent 회귀로 대체
- [x] direct answer·action·blocked re-plan·on-demand capture 테스트
- [x] runtime start retry/dedup·Local Network Access probe 테스트
- [x] format·lint·typecheck·전체 Vitest·build·audit
- [x] 320px·480px 단일 action UI·keyboard·live region 정적 QA
- [x] `docs/VERIFICATION.md` 최신 결과 기록

## L. 브라우저 조작 신뢰성 강화

### L-1. 관찰과 실행 안정성

- [x] 중앙 hit-test 기반 가려진 요소 관찰 제외
- [x] 실행 직전 `ELEMENT_OCCLUDED` 차단과 retryable 오류 보존
- [x] 클릭·Enter·폼 상태 변경 뒤 300ms DOM quiet period와 1.5초 최대 대기, `pageSettled` 결과 보존
- [x] window·중첩 컨테이너 스크롤의 deterministic auto behavior
- [x] stale·not-found·occluded·unsafe action 오류의 Background/tool result 전달

### L-2. 폼과 중첩 스크롤

- [x] Select option 표시 라벨·선택·disabled 상태 관찰과 내부 value 비노출
- [x] Exact label `select_option`과 중복·disabled·미존재 option 차단
- [x] Checkbox/radio boolean 상태와 `set_checked`, radio clear 차단
- [x] 가시적인 scrollable ancestor 등록과 방향 제한 `scroll_element`
- [x] Select·checked 변경 승인과 내부 스크롤 즉시 허용 정책

### L-3. 검증과 후속 범위

- [x] parser·observer·executor·policy·tab service·agent tool 회귀 테스트
- [x] 빌드 Content Script의 실제 Chromium control fixture 검증
- [x] Open Shadow DOM과 same-origin iframe 관찰 (섹션 R, composed 관찰)
- [ ] 사용자 승인 기반 cross-origin iframe 권한 확장
- [x] 새 탭·팝업 이동의 세션 인계 (섹션 N, 멀티탭 세션 추적)

## M. 적응형 신뢰성과 멀티모달 페이지 컨텍스트

### M-1. 설계와 하네스

- [x] 가상 특성 테스트로 교대 정체·동적 자막·실시간 영상 공백 재현
- [x] `ADAPTIVE_RELIABILITY_AND_VISION_DESIGN.md` 작성
- [x] `HARNESS_PLAN.md`와 `HARNESS_CHECKLIST.md` 작성

### M-2. 구현

- [x] 서로 다른 입력 외 동작의 불변 페이지 순환 정체 감지
- [x] 자막 안정 segment key, 전역 중복 제거, bounded 종료 재확인
- [x] action `pageSettled` true/false 전달과 unsettled 성공 시그니처 재실행 차단
- [x] YouTube `durationKnown`·`isLive` 상태, 실시간 seek 차단, 관찰 우선 자막 안내
- [x] 요청별 동의 자동 초기화와 provider-safe snapshot·캡처의 단일 multimodal message
- [x] 선행 action 뒤 캡처 deferred와 최신 재관찰 결합
- [x] 자막 quiet-check timeout의 미완료·부분 요약 처리
- [x] Side Panel 이미지 입력 지원 모델 안내

### M-3. 최종 검증

- [x] format·lint·typecheck·전체 Vitest·build·audit
- [x] 변경 파일 진단과 금지 패턴 검사
- [x] 정적 Side Panel과 모의 Chrome 런타임 브라우저 smoke QA
- [x] `docs/VERIFICATION.md` 최종 결과 기록

## N. 멀티탭 세션 추적

### N-1. 설계와 계약

- [x] Aside 브라우저 백그라운드 에이전트 방식 조사
- [x] `MULTITAB_SESSION_DESIGN.md` 설계 작성
- [x] ARCHITECTURE.md 세션 탭 계약과 ADR-009 동기화

### N-2. 구현

- [x] run별 세션 탭 추적 (탭 ID 기준)과 사용자 탭 전환 중단 제거
- [x] `openerTabId` 기반 새 탭·팝업 세션 인계와 후보 TTL 관리
- [x] 세션 탭이 닫힌 경우의 인계·종료 분기
- [x] 백그라운드 세션 탭 캡처의 임시 활성화와 이전 탭 복원
- [x] 백그라운드 content script 주입 실패의 `TAB_ACCESS_REQUIRED` 안내

### N-3. 검증

- [x] 세션 추적·인계·TTL·캡처 복원·권한 오류 테스트
- [x] 기존 탭 경계 회귀 테스트 갱신
- [x] format·lint·typecheck·전체 Vitest·build 통과

## O. 명시적 작업 계획(Planner)

### O-1. 설계와 계약

- [x] 복잡한 요청의 하위 태스크 분해 계약 설계
- [x] `create_plan`(2-10개 하위 태스크)과 `update_plan`(완료 수·현재 단계) 도구 정의

### O-2. 구현

- [x] 계획 호출의 엄격한 arguments validator와 실패 격리
- [x] 최신 계획 상태를 매 단계 관찰 메시지에 주입해 장기 run 목표 추적 유지
- [x] 계획 갱신 단계의 `PLAN` 진행 이벤트와 정체 감지 예외 처리

### O-3. 검증

- [x] 계획 파서·runner 주입·invalid arguments 테스트
- [x] format·lint·typecheck·전체 Vitest·build 통과

## P. 로컬 작업 메모리

### P-1. 설계와 계약

- [x] origin별 메모리 계약 설계 (`save_memory` 도구, origin 키, 보존 정책)
- [x] 개인 데이터·자격 증명 저장 금지 지침과 untrusted 주입 경계

### P-2. 구현

- [x] `StorageAgentMemoryService`와 `chrome.storage.local` 리포지토리
- [x] 노트 300자·origin별 8개·90일 보존·run당 3개 상한
- [x] run 시작 시 같은 origin 메모리 초기 컨텍스트 주입
- [x] completed 종료 시에만 저장, 저장 실패가 run을 실패시키지 않음

### P-3. 검증

- [x] 저장소 필터·TTL·상한 테스트와 runner 주입·저장 회귀 테스트
- [x] format·lint·typecheck·전체 Vitest·build 통과

## Q. 사용자 확인 일시 중단(pause/resume)

### Q-1. 설계와 계약

- [x] `pause_for_user` 도구와 승인 카드 재사용 계약 설계
- [x] pause 대기와 action 승인 grant의 분리 원칙

### Q-2. 구현

- [x] `ApprovalManager.requestPause` — run grant가 있어도 사용자 결정을 대기
- [x] 5분 상한 대기, 계속·거부 결과의 tool message 반영, run 취소 시 즉시 거부 처리
- [x] 시스템 프롬프트 지침(자격 증명 직접 처리 금지 유지)

### Q-3. 검증

- [x] pause 격리·계속·거부·취소 테스트와 runner 통합 테스트
- [x] format·lint·typecheck·전체 Vitest·build 통과

## R. 관찰 확장(composed 관찰)

### R-1. 설계와 계약

- [x] open shadow root와 same-origin iframe 관찰 범위 설계
- [x] frame·shadow root·요소 스캔 상한 정의

### R-2. 구현

- [x] shadow 경계를 통과하는 composed 부모 순회·hit-test·라벨 해석
- [x] same-origin iframe 프레임별 관찰(최대 5개)과 프레임별 viewport 좌표
- [x] shadow root 텍스트의 bounded 수집
- [x] executor의 focus·activeElement·가림 검사 composed 지원

### R-3. 검증

- [x] shadow 수집·숨김 호스트·iframe 수집·cross-origin 제외 테스트
- [x] 기존 관찰·실행 회귀 테스트 전부 통과
- [x] format·lint·typecheck·전체 Vitest·build 통과

## S. 프로바이더 호환성

### S-1. 도구 스키마 정리

- [x] 신규 도구의 `minItems`·`maxItems`·`minLength` 제거(일부 프로바이더가 거부하는 키워드)
- [x] 경계 검증은 자체 arguments validator에서 유지

### S-2. 오류 원인 가시화

- [x] 4xx(401/403 제외) 거부 시 프로바이더 응답 본문을 300자로 압축해 오류 메시지에 포함
- [x] API key 거부(401/403)는 응답 본문을 노출하지 않는 기존 보안 계약 유지

### S-3. 재시도 가능한 오류의 자동 백오프

- [x] `PROVIDER_REJECTED`(429/5xx)·`PROVIDER_TIMEOUT` 등 retryable 오류에 최대 3회, 1초→2초→4초 백오프 재시도
- [x] 재시도 중 run deadline·사용자 취소 즉시 반영과 `RETRY` 진행 이벤트 표시
- [x] 비재시도 오류와 재시도 소진 시 원본 오류 그대로 전파

### S-4. 검증

- [x] provider-http 오류 매핑 테스트(본문 포함·압축·재시도 여부·401 노출 금지)
- [x] anthropic/openai 클라이언트 인증 오류 노출 금지 회귀 유지
- [x] 재시도 성공·소진·비재시도 전파 runner 테스트
- [x] format·lint·typecheck·전체 Vitest·build 통과

## T. 유튜브 자막 경로 분석 기반 개선

### T-1. 라이브 분석 (실제 YouTube, Playwright)

- [x] 5개 영상에서 더보기→스크립트 표시 탐색과 세그먼트 파싱 검증 (4개 성공, 최대 11,718구간)
- [x] 신규 `PAmodern_transcript_view` UI 변형 확인 — YouTube `get_transcript` 400으로 세그먼트 미로드(YouTube 측 문제)

### T-2. 구현

- [x] 관찰 셀렉터에 `[role='tab']` 추가 — 신규 UI의 스크립트 탭을 에이전트가 조작 가능
- [x] 재시도 로직을 `provider-retry.ts` 공용 모듈로 추출(DRY)
- [x] 자막 청크·병합·최종 요약 provider 호출에 동일 백오프 재시도 적용
- [x] 실사용 피드백 반영: 자막 컨트롤이 비활성이면 `youtube_control(play)` 1회로 재생 시작 후 재시도 (탐색 예산에서 제외)

### T-3. 검증

- [x] tab 관찰 테스트와 자막 요약 재시도·비재시도 테스트
- [x] 재생 우선 순서 라이브 회귀 (2개 영상, 재생 중 자막 파싱 정상)
- [x] format·lint·typecheck·전체 Vitest(385)·build 통과

## U. 번들 스킬 시스템

### U-1. 설계와 계약

- [x] `skills/builtin` 스킬 컬렉션 조사와 Aside 형식 확인
- [x] `SKILLS_DESIGN.md` 설계 작성 (카탈로그·자동 주입·load_skill 계약)

### U-2. 구현

- [x] `skill-frontmatter.ts` 파서 (name/description/keywords/url, 들여쓰기 YAML 부분집합)
- [x] `SkillService` 카탈로그 캐시·본문 바운드(16,000자)·자동 주입 매칭(최대 2개)
- [x] `load_skill` 도구와 runner 처리, 카탈로그 인덱스 초기 메시지 주입
- [x] build.mjs의 skills 복사 + `index.json` 생성과 빌드 검증

### U-3. 검증

- [x] 파서·서비스·runner 통합 테스트 (실제 번들 파일 사용)
- [x] format·lint·typecheck·전체 Vitest(395)·build 통과

## V. YouTube 직접 HTTP 경로 (검색 + 자막 폴백)

### V-1. 근거

- [x] `.aside` 설치본의 youtube SKILL.md와 aside-daemon 구현 분석으로 엔드포인트 명세 확보
- [x] Innertube search(WEB)·player(ANDROID) 엔드포인트 curl 라이브 검증
- [x] 신규 UI 영상의 DOM 경로 한계 확인 → HTTP 폴백 필요성 입증

### V-2. 구현

- [x] `youtube_search` 도구 (query 1-200자, limit 1-10, 결과: videoId/url/title/channelName)
- [x] 콘텐츠 스크립트 youtube-http 클라이언트 (WEB search, ANDROID player captionTracks, timedtext XML 파싱)
- [x] `TRANSCRIPT_READ_CHUNK`의 DOM 실패 시 HTTP 폴백 (동일 청크 계약, videoId 캐시)
- [x] 안전 정책 allow 분류와 실행 결과 `data` 필드 전달, 실패 시 youtube.com 이동 안내

### V-3. 검증

- [x] search 파싱·XML 파싱·폴백 청크·videoId 추출·액션 파서·executor data 전달 테스트
- [x] 실제 YouTube 데이터로 전체 HTTP 자막 파이프라인 라이브 검증 (31 트랙 → 286 세그먼트)
- [x] format·lint·typecheck·전체 Vitest(404)·build 통과

## W. 범용 VTT 자막 계층 (Udemy 등)

### W-1. 근거

- [x] Udemy 강의 분석 흔적에서 사이트 내부 API 기반 VTT 직접 수집 기법 확인
- [x] 기존 청크 계약 재사용 설계 (DOM → YouTube HTTP → 범용 VTT 3계층)

### W-2. 구현

- [x] `transcript-segments.ts` 공용 모듈 추출 (세그먼트 변환·캐시, DRY)
- [x] `vtt-transcript.ts`: WEBVTT 파서, `<track>`·performance 리소스 발견, Udemy asset API 어댑터
- [x] `TRANSCRIPT_READ_CHUNK` 3계층 체인 연결과 자막 URL 비노출 원칙
- [x] 자막 가이던스에 "패널 열기 전 summarize 우선 호출" 지침 추가

### W-3. 검증

- [x] VTT 파싱(마크업·다중 줄·NOTE)·track/resource 발견·Udemy 로캘 우선 테스트
- [x] format·lint·typecheck·전체 Vitest(408)·build 통과
