# Browser Agent Extension Test Plan

## 1. 정적 검사

- Prettier format check
- ESLint with zero warnings
- TypeScript `tsc --noEmit`
- production build
- forbidden pattern scan: `eval`, `new Function`, `as any`, TypeScript suppression comments, hardcoded secret patterns
- `npm audit`

## 2. 단위 테스트

### Settings

- 10개 provider registry, 기본 Base URL/model/protocol/timeout
- 고정 origin과 Custom HTTPS URL 정규화 검증
- max steps 경계값 검증
- API key 마스킹, provider/origin scope 저장, provider 및 Custom origin 변경 시 제거
- 누락·손상 설정 fallback과 scope 없는 legacy key 제거
- Custom optional host permission 요청·거부·이전 origin 제거·저장 실패 rollback
- Side Panel·설정 화면 공통 Local Network Access probe, 실행 순서, 응답 정리, 차단 안내

### LLM protocol

- 텍스트 및 image URL 메시지 생성
- 정상 tool call 파싱
- 잘못된 JSON arguments 거부
- 알 수 없는 tool과 추가 속성 거부
- 성공 상태의 non-JSON body를 protocol 오류로 분류
- provider HTTP 상태 및 Local 480초/OpenAI 45초/기타 Cloud 120초 timeout 오류 변환
- OpenAI-compatible `/models`와 `/chat/completions` 요청
- Anthropic `/v1/models`, `/v1/messages` header와 system/image/tool 양방향 변환
- provider router의 native/compatible client 분기

### Side Panel chat renderer

- 사용자와 에이전트 말풍선 역할 구분
- 생각 중, 응답 완료, 중지, 오류 상태 라벨 갱신
- 승인, 거부, 만료와 이전 실행의 늦은 승인 응답 상태 전환
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
- 최대 단계 종료
- 실행 등록 전, provider 요청 시작 전, provider 요청 진행 중 사용자 취소
- 동일 실패 도구 반복 방지
- 승인 대기와 승인/거부 처리

### Content logic

- 보이는 element만 관찰
- 모든 입력값 제거와 링크 origin 최소화
- element registry 세대 교체
- React-style input setter와 input/change event
- YouTube state validation and command bounds

## 3. 통합 테스트

- toolbar action 클릭으로 tab-scoped Side Panel 열기와 activeTab 접근 안내
- mock Chrome API로 Side Panel ↔ Service Worker 메시지 왕복
- mock content port로 observe/action 흐름
- mock LLM server로 tool call 전체 사이클
- 실제 로컬 `/v1/models` 연결 검사는 별도 network test로 분리
- Cloud provider는 API key 없이 mock contract test를 실행하고 실제 key 검사는 수동 QA로 분리

## 4. 브라우저 QA

### 일반 페이지

- unpacked extension 로드
- side panel 열기
- Local 및 사용 가능한 Cloud provider 연결 검사
- Custom HTTPS origin 권한 승인·거부와 provider 전환 권한 정리
- 현재 화면 텍스트 분석
- 화면 캡처 API 거부 시 toolbar action 재클릭 안내
- Local provider 화면 분석 전 document-context Local Network Access probe와 이중 실패 안내
- 입력 필드 값 설정
- 버튼 클릭과 스크롤
- stale element 오류 후 재관찰
- 실행 중 탭 전환, 동일 탭 navigation, 메시지 처리 중 navigation 중단

### YouTube

- 영상 상태 표시
- play/pause
- seek, speed, volume 경계값
- 현재 프레임 분석
- 자막이 없는 영상의 fallback 안내

### 보안

- password 입력 차단
- submit 동작 승인 카드
- 승인 거부 후 실행 중단
- Chrome 내부 페이지의 명확한 unsupported 안내
- API key와 screenshot이 console에 없는지 확인

## 5. 뷰포트

- Side Panel width 320px
- Side Panel width 480px
- high contrast and keyboard-only navigation
