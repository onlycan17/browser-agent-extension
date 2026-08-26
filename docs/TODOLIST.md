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
- [x] 안정 page/action fingerprint 기반 3회 반복 정체 감지
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
- [x] 제목, URL, 시간, 길이, 상태 수집
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
- [x] selector 추측·반복 탐색 방지와 비대화형 분석의 조작 주장 없는 fallback
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
- [x] capture 이후 남은 call deferred 및 fresh image 재판단

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
- [x] 요청 복잡도에 비례한 prompt 기반 내부 planning
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
