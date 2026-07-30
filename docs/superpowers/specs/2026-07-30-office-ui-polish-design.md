# 오피스 UI/UX 개선 설계 — "살아있는 사무실"

작성일: 2026-07-30
대상: 이대리 콘솔 macOS 앱 "오피스" 탭
브랜치: `feat/office-ui-polish` (main 기준, Phase 4 PR #167 머지 이후)

---

## 1. 배경과 문제

오피스 탭은 Phase 4(PR #167)에서 SSE 이벤트 연출과 클릭 지시·승인까지 기능적으로 완성됐다. 남은 과제는 기능이 아니라 **미감·정보설계·생동감**이다. 현재 화면은 정적 대시보드처럼 보이고, 설계 원형인 "직원이 걸어다니고 회의·보고하는 살아있는 오피스"에 못 미친다.

구체적 진단 (`OfficeScene.swift`):

- 다크 배경 위에 **똑같이 생긴 회색 원 26개**(반지름 26). 에이전트 간 시각 구분이 상태색 하나뿐이라 PM·CTO·BE가 전부 같은 모양이다.
- 색이 오직 상태만 나타내 "누구인지(부서·역할)"는 전혀 안 보인다.
- 무슨 작업을 하는지, 얼마나 됐는지 같은 정보가 0이다.
- 5열 격자가 평평해 공간감이나 부서 위계가 없다.
- 대표실 밴드(상단)가 평소엔 비어 있고, 승인 집결 때만 원이 올라온다.
- 대기(회색) 상태가 완전 정지라 생동감이 없다.

핵심 관찰 하나: **대시보드 카드는 이미 상태색을 "테두리/accent + 옅은 배경 tint"로 쓰는데**(`Theme.swift`의 `accentColor`, `tintColor`), 오피스 씬만 상태색을 "꽉 찬 원 채움"으로 쓴다. 두 뷰의 색 언어가 어긋나 있다.

## 2. 목표

오는 데이터(agents·runs·approvals·sessions·pendingCommands)만으로, 새 백엔드 API 없이 오피스를 "살아있는 사무실"로 끌어올린다. 성공 기준:

- 한눈에 **누가(부서·역할) + 무슨 상태**가 동시에 읽힌다.
- 진행 중인 일이 무엇이고 얼마나 됐는지 보인다.
- 부서가 공간(방)으로 묶이고, 대표실이 항상 회사의 요약을 보여준다.
- 대기 중인 직원도 미세하게 살아 움직이고, 상태 전이·상호작용에 피드백이 있다.
- 대시보드와 오피스의 색 언어가 일치한다.

## 3. 비목표 (범위 밖)

- 새 백엔드 API나 콘솔 계약 변경.
- 커스텀 아바타 이미지 리소스 번들(SwiftPM resources) — CLT 실행 앱에서의 로딩 불확실성 때문에 이번 범위 밖. 정체성은 SF Symbol + 부서색 + 이니셜로 표현한다.
- 실제 캐릭터가 통로를 걸어다니는 경로 애니메이션(향후 과제).

---

## 4. 공통 시각 언어 — "직원 토큰"

똑같은 회색 원 26개를, **정체성(부서)과 상태(진행)를 분리한 직원 토큰**으로 교체한다.

```
        ┌─ 상태 링 (상태색: 완료 민트 / 진행 노랑 / 승인 핑크 / 연동 라벤더 / 대기 회색)
        │   진행 중이면 링이 회전하는 진행 호(arc)로 바뀐다
        ▼
      ╭─────╮        · 채움:  부서색 tint (은은한 정체성)
     ( ⚙ BE )       · 아이콘: 부서 SF Symbol (시스템 제공 → NSImage → SKTexture, 번들 불필요)
      ╰─────╯        · 링:    상태색 (대시보드 accent와 같은 의미) — 상태의 주 신호
       Backend       · 라벨:  displayName (보조색)
```

역할 분리의 규칙:

- **상태 = 링 색 + 모션.** 상태 팔레트 단일 소스 `agentStatePaletteRGBA`(ConsoleCore)를 그대로 링에 쓴다. 대시보드가 상태색을 테두리로 쓰는 것과 의미가 일치해 두 뷰가 정렬된다.
- **부서 = 아이콘 + 채움 tint + (Phase 3) 방 배치.** 부서색은 ConsoleCore에 `agentDepartmentPaletteRGBA` 신규 순수함수로 추가한다. 팔레트를 ConsoleCore에 두는 경계(대시보드 Color·씬 SKColor 공통 참조)를 유지한다.

이 분리가 현재의 근본 문제("색이 상태 하나만 표현")를 푼다. 링·채움·아이콘이 각각 상태·부서·역할을 맡아, 한 토큰에서 세 가지 정보가 동시에 읽힌다.

기각한 대안 — "부서 = 채움 / 상태 = 링" (역방향): 오피스의 본질은 "지금 무엇이 돌아가는가"라 상태가 더 튀어야 하는데, 채움이 링보다 눈에 띈다. 상태를 링으로 두는 편이 우선순위에 맞고 대시보드와도 일치한다.

## 5. 부서 매핑 (26개 → 6구획)

`agent-registry.ts`의 26개 에이전트를 6개 부서로 묶는다. 매핑은 ConsoleCore의 순수함수 `department(for agentType:)`로 두고 테스트로 고정한다.

| 부서 | 에이전트 | 색 방향(제안) | 아이콘 방향(SF Symbol) |
|---|---|---|---|
| 기획 | PM, PO_SHADOW, PO_EVAL | 파랑 | 나침반 / 차트 |
| 개발 | BE, BE_SCHEMA, BE_TEST, BE_SRE, BE_FIX | 청록 | 톱니 / 터미널 |
| 리뷰 | CODE_REVIEWER, WORK_REVIEWER, IMPACT_REPORTER | 인디고 | 돋보기 / 체크 |
| 경영 | CTO, CEO | 골드 | 왕관 / 빌딩 |
| 성장 | CAREER_MATE, JOB_APPLICATION, BLOG, VACATION | 코랄 | 새싹 / 문서 |
| 내부 | ISSUE_LABELER, SUBCONSCIOUS_GATE, CONTRADICTION_JUDGE, HUMANIZER, DOCS_AUDIT_OPTIMIZER, DOCS_AUDIT_EVALUATOR, PREFERENCE_LEARNING, EVENING_RETRO, OPS_SUPERVISOR | 슬레이트 | 기어 / 자동화 |

색 값과 아이콘 심볼명 확정은 Phase 1 구현 시 `frontend-design` 관점으로 미세조정한다. 제약은 두 가지: (1) 부서 6색이 서로 구분되고 5개 상태색과도 충돌하지 않을 것(부서색은 채움/아이콘, 상태색은 링이라 역할은 다르지만 색상은 겹치지 않게), (2) 채움 tint는 낮은 불투명도(제안 0.16~0.22)로 상태 링 가독성을 해치지 않을 것.

매핑에 없는(향후 추가될) agentType은 "내부/기타" 부서로 폴백해 크래시 없이 흡수한다.

---

## 6. Phase 1 — A(표현) + D(모션·피드백): "살아있는 직원"

가장 먼저 "살아있는 느낌"을 만든다. 레이아웃(C)은 기존 격자를 유지한 채 토큰만 교체하므로 독립적으로 눈에 보이는 개선이 된다.

### A. 에이전트 표현

공통 시각 언어의 직원 토큰을 구현한다.

- 기존 `SKShapeNode(circleOfRadius:)`를 유지·확장한 합성 노드로 만든다. 원 반지름은 유지해 기존 펄스·집결·핸드오프 연출을 재사용한다.
- 상태 링: stroke 폭 약 4, 색 = 상태색.
- 부서 채움: 부서색 tint.
- 부서 아이콘: SF Symbol을 `NSImage(systemSymbolName:)` → `SKTexture`로 렌더해 토큰 중앙에 얹는다.
- 깊이감: `glowWidth` 또는 반투명 additive 헤일로. per-node CIFilter blur는 26개 성능 문제로 쓰지 않는다.
- 진행 호: 진행 중일 때 링을 **회전하는 부분 호**(indeterminate 스피너)로. 완료 %를 모르므로 진행률 표시가 아니라 "일하는 중" 신호로 정직하게 쓴다.

### D. 모션·피드백

- **대기 숨쉬기**: waiting 노드에 아주 미세한 scale 반복(제안 1.0↔1.03, ~3초, ease-in-out). 현재 대기=정지를 살아있게 만든다.
- **상태 전이**: 링 색을 즉시 교체하지 않고 부드럽게 lerp. 기존 recolor의 scale bounce 톤과 이어지게.
- **hover** (`mouseMoved`): 해당 토큰 살짝 확대 + 밝아짐 + 툴팁. macOS SpriteKit에서 `mouseMoved` 수신은 윈도우 `acceptsMouseMovedEvents` + tracking area 설정이 필요하다(리스크 §9-2). 실패 시 상시 정보 + 클릭으로 폴백.
- **선택 강조**: 클릭된 토큰에 지속 하이라이트 링. 현재 씬은 선택 표시가 없다(선택 상태는 뷰의 `selectedAgent`에만 있음).
- 기존 연출(펄스·집결·핸드오프·거절)과 톤을 맞춘다.

### 검증
- ConsoleCore: 부서 매핑, 부서 팔레트, 진행 호 geometry(순수 계산)에 단위 테스트.
- IdaeriConsole: SF Symbol → SKTexture 렌더가 CLT 실행 앱에서 되는지 **첫 스텝에서 스모크 확인**(리스크 §9-1).

---

## 7. Phase 2 — B(정보 밀도): "뭘 하는지 한눈에"

Phase 1의 토큰 위에 정보를 얹는다.

- **말풍선**: `ConsoleAgent.bubble`(이미 데이터 존재)을 활성(진행/승인) 에이전트는 상시 노출, 나머지는 hover 시 노출. 26개 상시 노출은 난잡하므로 활성만 상시로 제한한다.
- **경과 시간**: `runs`의 `startedAt`으로 "3분째" 같은 경과를 계산(ConsoleCore 순수함수)해 토큰 근처 또는 툴팁/말풍선에 표시.
- **pending 배지**: `pendingCommands.phase` → ⏳🔄✅⚠️(이미 `PendingPhase.badgeIcon`, Theme.swift)를 대상 토큰에 붙인다.

### 검증
- ConsoleCore: 경과 시간 포맷 함수(경계값·긴 시간·미래 시각 방어)에 단위 테스트.
- 활성/비활성 노출 규칙이 store 상태에 따라 옳게 갈리는지.

---

## 8. Phase 3 — C(레이아웃·대표실): "부서 방 + 대표실"

가장 큰 순수 로직(레이아웃)을 마지막에. 토큰·정보가 확정된 뒤 배치를 바꾼다.

- **부서 방**: 평평한 5열 격자를 부서별 구역(방)으로 바꾼다. 방마다 옅은 rounded-rect 배경(부서 tint)과 방 라벨(부서명). 배치는 ConsoleCore의 순수 layout 함수로: 에이전트 + 부서 매핑 → 방별 그룹 좌표, 방 사각형, 라벨 좌표. 대표실 밴드는 상단에 예약. 내부부서 9개처럼 불균등한 방 크기를 처리한다(방 안 격자 자동 조정).
- **대표실 밴드** (현재 빈 상단):
  - 상시 **"나(대표)" 노드** — 대표(owner)를 나타내는 구분되는 노드를 상단 중앙에 항상 둔다.
  - **전사 요약 HUD** — 진행 N · 승인 M · 대기 K를 store 집계 순수함수로 계산해 밴드에 표시.
  - 기존 승인 집결(summonToBand)은 그대로 이 밴드로 들어온다.

### 검증
- ConsoleCore: 방 레이아웃(방끼리 비겹침, 에이전트가 자기 방 안, 밴드 높이 예약, 대표 중앙, 불균등 방 처리), 전사 요약 집계에 단위 테스트 대량.

---

## 9. 아키텍처 분리 (불변 제약)

- **ConsoleCore (순수·테스트)**: 부서 매핑, 부서 팔레트, 방 레이아웃, 경과 포맷, 전사 요약 집계, 진행 호 geometry.
- **IdaeriConsole (SpriteKit)**: 토큰 합성(SF Symbol→SKTexture·링·호·글로우), 숨쉬기·hover·선택 SKAction, 방 배경·라벨 렌더, 대표 노드, 툴팁, `mouseMoved` 배선.
- CLT 전용: Xcode·XCTest 없음. `swift build` + 실행형 러너 `swift run ConsoleCoreTests`.
- 새 백엔드 API 0. 오는 데이터만 사용.

## 10. 리스크와 완화

1. **SF Symbol → SKTexture (CLT 앱)**: 시스템 제공 심볼이라 리소스 번들 불필요. 낮은 리스크지만, Phase 1 첫 스텝에서 심볼 1개 렌더 스모크로 실증한다.
2. **`mouseMoved` hover**: 윈도우 `acceptsMouseMovedEvents` + tracking area 필요. 중간 리스크. 폴백은 "활성 상시 정보 + 클릭 상세".
3. **26개 화면 공간**: 내부부서 9개가 크다. 방별 토큰 크기·격자 조정으로 흡수한다.
4. **글로우·그림자 성능**: `glowWidth`/additive만. per-node CIFilter blur 금지.

## 11. 브랜치·의존성

- Phase 4 PR #167은 머지됨. 이 작업은 `main` 기준 `feat/office-ui-polish`에서 진행한다.
- Phase 1 → 2 → 3 순서로 각각 독립 플랜·PR. 각 단계가 독립적으로 눈에 보이는 개선이 되도록 설계했다.
