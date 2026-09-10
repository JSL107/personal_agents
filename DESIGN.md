# Design

## Source of truth

- Status: Active
- Date: 2026-09-10
- Product surfaces: macOS 이대리 콘솔의 대시보드와 오피스
- Evidence reviewed: 사용자 승인 초안, 3D 치비 캐릭터 레퍼런스, 현재 SwiftUI/SpriteKit 구현, `OfficeFloorPlan`, 렌더 스냅샷

## Brand

- Personality: 귀엽고 따뜻하며 활기찬 작은 사무실. 업무 상태가 부담스럽지 않게 읽혀야 한다.
- Trust signals: 사원 이름, 부서, 상태, 현재 업무는 장식보다 먼저 식별된다.
- Avoid: 기괴한 인체 비율, 픽셀과 반실사의 혼합, 어두운 스튜디오 렌더, 한 장 배경 위에 스티커처럼 얹은 캐릭터와 가구.

## Product goals

- 대시보드에서 담당자 상태와 다음 행동을 빠르게 파악한다.
- 오피스에서 여러 부서와 여러 사원의 위치·상태·상호작용을 한눈에 이해한다.
- 기존 2D 타일 기반 업무 로직을 유지하면서 시각적으로는 약한 2.5D 하이앵글 공간을 제공한다.
- Non-goals: 자유 회전 카메라, 완전한 3D 물리 공간, 고정 인원 수가 박힌 단일 배경 이미지.
- Success signals: 방·가구·캐릭터의 원근과 조명이 일치하고, 사원 수가 변해도 배치가 자연스럽다.

## Personas and jobs

- 팀 운영자: 어떤 에이전트가 일하고 쉬고 승인 대기 중인지 확인한다.
- 담당자: 카드와 오피스에서 에이전트를 선택하고 업무를 맡기거나 상세 상태를 본다.
- 관찰 맥락: 데스크톱 창의 전체 오피스 뷰, 부서 포커스 뷰, 우측 담당자 상세 패널.

## Information architecture

- Dashboard: 전체 현황 → 부서/상태 필터 → 담당자 카드 → 업무 위임.
- Office: 전체 오피스 → 부서별 독립 방 → 사원/가구 상호작용 → 담당자 상세.
- 공용 공간: 회의실, 대표실, 탕비실은 부서 방과 분리된 상단 밴드로 유지한다.

## Design principles

- 논리와 표현을 분리한다: `OfficeFloorPlan`은 2D 타일 SSOT, SpriteKit은 2.5D 표현 계층이다.
- 같은 바닥면을 공유한다: 방, 동적 가구, 캐릭터, 이동 목표에 같은 투영과 깊이 규칙을 적용한다.
- 인원 수에 반응한다: 책상과 좌석은 배경에 고정하지 않고 `DeskAssignment`에서 만든다.
- 귀여움은 일관성에서 나온다: 캐릭터는 하나의 비율·재질·조명 패밀리로 통일한다.
- 운영 정보가 장식보다 우선한다: 상태 링, 이름, 선택 상태의 가독성을 보존한다.

## Visual language

- Color: 크림, 밝은 원목, 세이지, 라벤더, 살구색 중심의 따뜻한 저채도 팔레트.
- Typography: 기존 macOS 시스템 글꼴과 최소 크기를 유지해 한글 가독성을 보장한다.
- Spacing: 방과 공용 공간을 명확히 분리하되 통로는 연속적으로 보이게 한다.
- Shape/elevation: 큰 라운드 모서리, 부드러운 그림자, 얇은 테두리. 강한 유리광택과 검은 그림자는 피한다.
- Motion: 짧고 부드러운 보행·타이핑·대기 모션. Reduce Motion에서는 즉시 배치한다.
- Character art: 머리 40~45%, 큰 단순형 glossy eyes, 짧고 둥근 팔다리, 장난감형 3D 재질, 밝은 크림 조명, 전신 투명 PNG.
- Character constants: 둥근 얼굴·눈 비율·compact chibi 체형·부드러운 3D 음영·따뜻한 광원은 전 캐릭터에서 고정한다.
- Character variants: 헤어 길이와 질감, 얼굴 인상과 표정, 셔츠·가디건·후드·재킷·하의, 안경·리본·헤드셋·사원증은 자유롭게 조합하되 신규 캐릭터마다 최소 두 축을 기존 인원과 다르게 한다.
- Office art: 살짝 기울어진 3/4 high-angle 2.5D. 방 shell은 건축·조명만 포함하고 실제 책상·의자·소파는 동적 자산으로 배치한다.

## Components

- `DashboardView`, `AgentCardView`: 카드 계층과 상태/행동.
- `OfficeScene`, `OfficeView`: 타일 로직, 2.5D 투영, 선택과 이동.
- `CozyOfficeNodeFactory`: 방 shell과 독립 가구 노드.
- `CozyCharacterArtworkNode`, `SpriteLoader`: 동일 캐릭터의 pose별 자산과 fallback.
- Asset ownership: `Resources/cozy/rooms`, `Resources/cozy/furniture-3d`, `Resources/cozy/characters`.

## Accessibility

- 상태는 색만으로 전달하지 않고 이름·텍스트·아이콘을 함께 제공한다.
- 키보드 포커스와 VoiceOver용 이름/상태 설명을 유지한다.
- 텍스트 최소 크기와 명암 대비를 축소 뷰에서도 보존한다.
- Reduce Motion에서 이동·흔들림을 제거해도 상태 변화가 이해되어야 한다.

## Responsive behavior

- 3열/2열 오피스 배치는 기존 `officeFloorPlan` 규칙을 유지한다.
- 창 크기와 부서 포커스 전환 시 투영 좌표를 재계산한다.
- 좁은 창에서도 캐릭터·가구가 방 경계를 넘지 않고 이름표가 겹치지 않아야 한다.

## Interaction states

- Loading/offline/error는 기존 콘솔 상태 표현을 유지한다.
- Agent states: waiting, inProgress, awaitingApproval, awaitingIntegration, completed, failed.
- Pose contract: idle, walk, seated-work, talk을 우선하고 reading/writing/drinking 등 상호작용 pose를 확장한다.
- pose 자산이 없으면 동일 스타일의 idle 자산으로 fallback하되 개발 로그에 누락을 남기고, 전용 pose가 존재할 때는 fallback용 축소·위치 보정을 적용하지 않는다.

## Content voice

- 짧고 친근한 한국어. 역할명과 명령어 같은 실제 식별자는 원문을 유지한다.
- 상태 문구는 감성 문구보다 현재 행동을 먼저 설명한다.

## Implementation constraints

- SwiftUI + SpriteKit 구조와 `OfficeFloorPlan`의 타일 좌표/길찾기를 유지한다.
- 방 shell 하나에 사원·책상 수를 굽지 않는다.
- 가구와 캐릭터는 같은 floor projection과 depth ordering을 사용한다.
- 캐릭터 PNG는 실제 alpha channel과 투명 모서리를 가져야 한다.
- 변경 후 `swift run ConsoleCoreTests`, `swift build`, asset/color/render check와 루트 `pnpm lint:check`, `pnpm test`, `pnpm build`를 통과한다.
- 최종 시각 평가는 승인 초안과 최신 캐릭터 레퍼런스를 기준으로 독립 검토한다.

## Open questions

- [ ] pose별 원화 1차 범위를 idle/walk/seated-work/talk 네 종류로 확정할지 — owner: product — impact: 애니메이션 제작량.
- [ ] 부서별 방 shell의 개별 원근 보정값이 필요한지 최종 렌더에서 판정 — owner: design — impact: 가구 발 위치 정밀도.
