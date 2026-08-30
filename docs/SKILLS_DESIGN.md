# 번들 스킬 시스템 설계 (Bundled Skills)

## 1. 목표

에이전트가 `skills/builtin/`에 번들된 스킬(사이트별 지침, YouTube, Chrome, 비밀번호 관리자 등)을 런타임에 활용해 사이트 특화 작업의 성공률을 높인다. 스킬은 Aside 형식(`SKILL.md` frontmatter + 본문)을 그대로 사용한다.

## 2. 구조

```text
skills/builtin/**/SKILL.md      (확장 패키지에 정적 포함, 원격 코드 없음)
skills/index.json               (빌드가 생성하는 파일 경로 목록)
src/shared/skill-frontmatter.ts (frontmatter 파서 — name/description/keywords/urls)
src/background/skill-service.ts (카탈로그 캐시, 본문 로드, 자동 주입 매칭)
AgentRunner                     (카탈로그 주입, load_skill 도구 처리)
```

## 3. 데이터 흐름

1. 빌드: `scripts/build.mjs`가 `skills/**`를 `dist/skills/`로 복사하고 `.md` 파일 경로 목록을 `dist/skills/index.json`으로 생성한다. SKILL.md가 하나도 없으면 빌드 실패.
2. 런타임: `SkillService`가 최초 `catalog()` 호출 시 `index.json`을 읽고 각 SKILL.md를 fetch해 frontmatter를 파싱해 캐시한다(프로세스당 1회).
3. run 시작: 페이지 URL(`autoInject.url` 호스트 일치, 서브도메인 포함)과 요청 키워드(`autoInject.keywords`)로 매칭된 스킬 **최대 2개**의 본문을 초기 메시지에 주입하고, 전체 카탈로그 인덱스(`이름: 설명`)도 함께 제공한다.
4. 모델은 필요 시 `load_skill(name)`을 호출해 스킬 본문(최대 16,000자, frontmatter 제외)을 tool message로 받는다. 이름은 카탈로그와 대조되며, 목록에 없으면 실패 응답.

## 4. 신뢰 경계

- 스킬은 패키지에 번들된 개발자 제공 콘텐츠다. 페이지 데이터처럼 "지시문으로 취급 금지"까지는 아니지만, 시스템 프롬프트가 "스킬이 안전 정책을 재정의하지 않는다"고 명시한다.
- 스킬 내용은 원격에서 오지 않는다(빌드 시 포함). 본문 크기와 카탈로그 크기(60개)는 상한으로 제한된다.
- 자동 주입 실패와 카탈로그 로드 실패는 run을 실패시키지 않는다(빈 컨텍스트로 진행).

## 5. 검증

- frontmatter 파서: 실제 번들 파일(youtube) 파싱, url 호스트/서브도메인 매칭, 키워드 매칭
- SkillService: 카탈로그 캐시, 무효 파일 스킵, 이름 조회, 최대 2개 자동 주입, 본문 상한
- runner: 초기 메시지의 카탈로그+자동 주입, load_skill 성공/미지명 실패
- build: SKILL.md 부재 시 빌드 실패, `dist/skills/index.json` 생성

## 6. 제한 사항 (후속 범위)

- `chrome/history.md`처럼 SKILL.md를 보조하는 추가 .md 파일은 index.json에 포함되지만 `load_skill` 이름 조회 대상은 아니다(SKILL.md만 카탈로그).
- youtube 스킬이 참조하는 REPL 전역(`youtube.search()` 등)은 이 확장에 없으므로, 해당 스킬 본문은 참고용으로만 주입된다.
