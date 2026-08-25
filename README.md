# Browser Agent Extension

Chrome Side Panel에서 현재 탭을 분석하고, 안전 정책과 사용자 승인을 거쳐 클릭·텍스트 입력·스크롤·YouTube 제어를 수행하는 Manifest V3 확장 프로그램입니다.

## 주요 기능

- 현재 탭의 보이는 텍스트와 상호작용 요소 구조화
- 선택적 PNG 화면 캡처와 비전 모델 분석
- 관찰 시점의 일회성 element ID를 이용한 클릭·텍스트 입력·키·스크롤
- 최대 단계, 즉시 중단, 반복 실패 차단을 포함한 LLM tool-call 에이전트
- 전송·구매·삭제·로그인·외부 이동 전 사용자 승인
- 비밀번호·결제 카드·인증 코드·파일 입력 차단
- YouTube 상태·현재 자막 분석과 재생·정지·탐색·속도·볼륨 제어
- 완료·중지된 에이전트 답변 복사와 네이티브 공유
- Local, OpenAI, Anthropic, OpenRouter, Groq, Together AI, DeepSeek, Mistral, xAI 설정
- 사용자 승인 기반 HTTPS Custom OpenAI-compatible endpoint 등록

## 기본 로컬 모델

- Base URL: `http://192.168.10.105:3620/v1`
- Model: `qwen/qwen3.8-27b`
- API key: 선택 사항

로컬 HTTP 통신은 암호화되지 않습니다. 신뢰할 수 있는 사설 네트워크에서만 사용하세요. 최신 Chrome에서는 첫 연결 시 로컬 네트워크 접근 권한을 요청할 수 있습니다.

## 설치 및 빌드

필수 환경:

- Node.js 24 이상
- Chrome 116 이상

```bash
npm install
npm run build
```

Chrome에서 다음 순서로 로드합니다.

1. `chrome://extensions`를 연다.
2. **개발자 모드**를 켠다.
3. **압축해제된 확장 프로그램을 로드합니다**를 선택한다.
4. 이 프로젝트의 `dist/` 폴더를 선택한다.
5. 확장 카드의 버전이 `0.2.0`인지 확인한다.
6. 툴바의 Browser Agent 아이콘을 눌러 Side Panel을 연다.

## 사용 방법

Side Panel은 사용자 요청과 에이전트 응답을 채팅 말풍선으로 구분합니다. 상단 상태에서 `생각 중`, `승인 대기`, `응답 완료`, `중지됨`, `오류`를 확인할 수 있으며 모델의 제목과 목록도 읽기 쉬운 형식으로 표시합니다. 완료되거나 중지된 답변은 말풍선 아래에서 복사하거나 운영체제 공유 시트로 전달할 수 있습니다. 공유 시트를 지원하지 않는 환경에서는 답변을 클립보드에 복사하고 결과를 안내합니다.

1. 설정 화면에서 사용할 provider를 선택하고 model ID와 API key를 입력한다.
2. Custom은 HTTPS OpenAI-compatible Base URL을 입력하고 저장할 때 Chrome의 해당 origin 접근 권한을 승인한다.
3. **저장 후 연결 확인**으로 모델 연결을 검사한다. Local에서 Chrome이 로컬 네트워크 접근 권한을 요청하면 **허용**한다.
4. 먼저 분석하거나 조작할 웹 페이지를 활성 탭으로 연다.
5. 해당 탭에서 Browser Agent 툴바 아이콘을 눌러 `activeTab` 권한을 부여하고 Side Panel을 연다. Chrome의 일반 Side Panel 메뉴로 직접 열면 탭 접근 권한이 부여되지 않는다.
6. 화면 분석 또는 에이전트 실행을 선택한다.
7. 승인 카드가 나타나면 대상과 이유를 확인한 뒤 한 번 승인하거나 거부한다.

API 키는 provider와 origin scope를 함께 기록해 기본적으로 `chrome.storage.session`에 저장됩니다. 영구 저장을 선택해도 운영체제 보안 키체인이 아니라 Chrome 로컬 저장소에 보관됩니다. v0.1.x에서 저장한 scope 없는 API key는 v0.2.0에서 안전하게 제거되므로 한 번 다시 입력해야 합니다.

## 검증 명령

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:run
npm run build
npm audit --audit-level=moderate
```

## 알려진 제한

- 화면 캡처는 현재 보이는 탭 영역만 지원합니다.
- Chrome 내부 페이지, Chrome Web Store, 다른 확장 UI는 조작할 수 없습니다.
- shadow DOM과 cross-origin iframe 내부는 관찰하지 않습니다.
- YouTube는 현재 보이는 프레임, 플레이어 상태, 현재 표시 자막을 분석합니다. 구간별 자동 프레임 샘플링은 후속 범위입니다.
- DRM 또는 보호된 영상은 캡처 결과가 검게 나올 수 있습니다.
- 로컬 비전 분석은 최대 480초까지 걸릴 수 있으며 중지 버튼으로 취소할 수 있습니다.
- 서비스 워커가 재시작되면 진행 중인 에이전트와 승인 요청은 안전하게 취소되며 자동 재개하지 않습니다.

## 설계 문서

- `docs/PRD.md`
- `docs/MULTI_PROVIDER_DESIGN.md`
- `docs/ARCHITECTURE.md`
- `docs/API.md`
- `docs/SECURITY.md`
- `docs/TEST_PLAN.md`
- `docs/TODOLIST.md`
