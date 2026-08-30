# 멀티탭 세션 추적 설계 (Multi-Tab Session Tracking)

## 1. 목표

Aside 브라우저의 백그라운드 에이전트 방식을 참고해, 에이전트가 **특정 탭을 추적**하며 사용자가 다른 탭을 보는 동안에도 작업을 계속할 수 있게 한다.

- 변경 전: run이 시작되면 활성 탭에 고정(pin)되고, 사용자가 탭을 옮기면 `TAB_CHANGED`로 즉시 종료된다.
- 변경 후: run은 시작 시점의 탭을 **세션 탭**으로 추적하고, 사용자가 다른 탭으로 이동해도 세션 탭에서 계속 관찰·실행한다.

## 2. 범위

### 포함

- run별 세션 탭 추적 (탭 ID + 창 ID + URL 기준)
- 사용자의 탭 전환은 더 이상 실행을 중단하지 않음
- 승인된 탐색 동작 직후 세션 탭이 연 새 탭(`openerTabId === 세션 탭 ID`)으로 세션 인계
- 세션 탭이 닫혔을 때 인계 후보가 있으면 인계, 없으면 기존처럼 `TAB_CHANGED` 종료
- 세션 탭이 활성 탭이 아닐 때 캡처: 임시 활성화 → 캡처 → 이전 탭 복원
- 백그라운드 탭 접근 권한 상실 시 `TAB_ACCESS_REQUIRED` 안내

### 제외 (후속 범위)

- cross-origin 새 탭 인계의 무권한 동작 (사이트 권한을 부여한 경우에만 가능 — 기존 `optional_host_permissions` 활용)
- 새 탭 후보의 사용자 승인 UI 확장

## 3. 권한 모델 (변경 없음)

- 여전히 `activeTab` 기반 최소 권한. 세션 탭의 content script 접근은 시작 시 획득한 activeTab 권한과 이미 주입된 content script에 의존한다.
- 세션 탭이 cross-origin으로 이동하거나, opener가 연 새 탭에 권한이 없으면 접근 오류로 안내한다. 광범위한 host permission을 요구하지 않는다.

## 4. 세션 상태 모델

```text
TabService (runId별 상태)
  sessionTabs: Map<runId, { id, windowId, url }>
  navigationAllowances: Set<runId>
  lastNavigatingActionAt: Map<runId, number>   // 탐색 가능 동작 실행 시각
  tabCandidates: TabCandidate[]                // 전역 ring buffer (최대 50, TTL 2분)
    { tabId, openerTabId, createdAt }
```

### tabForRun(runId) 결정 트리

1. `runId` 없음 → 기존처럼 활성 탭 사용 (설정 화면 연결 검사 등).
2. 세션 없음 → 활성 탭을 세션으로 채택.
3. `adapter.get(session.id)`로 세션 탭 재조회.
   - 탭 존재 + 인계 후보 있음(`createdAt >= lastNavigatingActionAt`, `openerTabId === session.id`) → **세션을 새 탭으로 인계**.
   - 인계 후보 없음 → 기존 URL 검증(같은 URL 통과, same-origin allowance로 갱신, 아니면 `TAB_CHANGED`).
4. 세션 탭이 사라짐(get 실패) → 인계 후보 탐색 → 있으면 채택, 없으면 `TAB_CHANGED` 종료.

### 인계 조건의 안전 근거

- 후보는 `openerTabId === 세션 탭`인 탭뿐 — 세션 탭이 직접 연 탭만 인계한다. 사용자가 연 탭은 인계하지 않는다.
- 후보는 `lastNavigatingActionAt` 이후 생성된 것만 인계한다. 승인받은 클릭/Enter가 새 탭을 연 결과로만 인정한다.
- 인계 시 세션 URL 갱신과 navigation allowance 폐기를 함께 수행한다.

## 5. 백그라운드 캡처

```text
captureActivePage(runId)
  1. tabForRun으로 세션 탭 확정
  2. queryActiveInWindow(windowId)로 세션 탭이 활성 탭인지 확인
  3. 활성 탭이면 기존 rate limit 경로로 캡처
  4. 아니면: 이전 활성 탭 ID 기록 → activate(세션 탭) + focusWindow → 캡처 → 이전 탭 활성화 복원
  5. 캡처 후 tabForRun 재검증으로 캡처 중 navigation 감지
```

## 6. 오류 매핑

| 상황                                   | 오류                                           |
| -------------------------------------- | ---------------------------------------------- |
| 세션 탭 닫힘 + 인계 후보 없음          | `TAB_CHANGED` (비재시도)                       |
| 예상 밖 same-tab navigation            | `TAB_CHANGED` (비재시도) — 기존과 동일         |
| 백그라운드 탭 content script 주입 실패 | `TAB_ACCESS_REQUIRED` (비재시도) + 재부여 안내 |
| 캡처 거부                              | `CAPTURE_FAILED` (재시도 가능) — 기존과 동일   |

## 7. ADR-009: 탭 전환 허용과 opener 기반 세션 인계

- 사용자의 탭·창 전환은 더 이상 run을 종료하지 않는다. 에이전트는 세션 탭에서 계속 작업한다.
- 예상 밖 동작(세션 탭 닫힘, 교차 origin same-tab navigation)은 기존 정책대로 종료한다.
- 새 탭 인계는 승인된 탐색 동작의 직접 결과로만 자동 인정된다. 승인되지 않은 새 탭은 인계하지 않는다.

## 8. 검증

- 기존 탭 경계 테스트를 세션 모델에 맞게 갱신한다.
- 신규: 사용자 탭 전환 지속, opener 인계, 무관한 새 탭 미인계, 닫힘 후 인계, 후보 TTL 만료, 백그라운드 캡처 복원, 주입 권한 오류.
- 전체: format/lint/typecheck/test/build.
