# Design

> 대상은 macOS 이대리 콘솔(`clients/idaeri-console`)의 현재 화면이다. 오피스 탭(SpriteKit 2D·3D 오피스, `clients/office-web`)은 #875 에서 제거했다. 그 설계 기록은 [`docs/archive/2026-09-10-console-office-design.md`](./docs/archive/2026-09-10-console-office-design.md) 에 있으며 현재 작업의 기준이 아니다.

## Source of truth

- Status: Active
- Product surfaces: macOS 이대리 콘솔 — 대시보드(담당자 카드)와 에이전트 아바타·마스코트

## Brand

- Personality: 귀엽고 따뜻하며 활기찬 작은 사무실. 업무 상태가 부담스럽지 않게 읽혀야 한다.
- Trust signals: 사원 이름, 부서, 상태, 현재 업무는 장식보다 먼저 식별된다.
- Avoid: 기괴한 인체 비율, 픽셀과 반실사의 혼합, 어두운 스튜디오 렌더.

## Product goals

- 대시보드에서 담당자 상태와 다음 행동을 빠르게 파악한다.

## Personas and jobs

- 팀 운영자: 어떤 에이전트가 일하고 쉬고 승인 대기 중인지 확인한다.
- 담당자: 카드에서 에이전트를 선택하고 업무를 맡기거나 상세 상태를 본다.

## Information architecture

- Dashboard: 전체 현황 → 부서/상태 필터 → 담당자 카드 → 업무 위임.

## Design principles

- 귀여움은 일관성에서 나온다: 캐릭터는 하나의 비율·재질·조명 패밀리로 통일한다.
- 운영 정보가 장식보다 우선한다: 상태 링, 이름, 선택 상태의 가독성을 보존한다.

## Visual language

- Color: 크림, 밝은 원목, 세이지, 라벤더, 살구색 중심의 따뜻한 저채도 팔레트.
- Typography: 기존 macOS 시스템 글꼴과 최소 크기를 유지해 한글 가독성을 보장한다.
- Shape/elevation: 큰 라운드 모서리, 부드러운 그림자, 얇은 테두리. 강한 유리광택과 검은 그림자는 피한다.
- Motion: 짧고 부드러운 모션. Reduce Motion에서는 즉시 배치한다.
- Character art: 머리 40~45%, 큰 단순형 glossy eyes, 짧고 둥근 팔다리, 장난감형 3D 재질, 밝은 크림 조명, 전신 투명 PNG.
- Character constants: 둥근 얼굴·눈 비율·compact chibi 체형·부드러운 3D 음영·따뜻한 광원은 전 캐릭터에서 고정한다.
- Character variants: 헤어 길이와 질감, 얼굴 인상과 표정, 셔츠·가디건·후드·재킷·하의, 안경·리본·헤드셋·사원증은 자유롭게 조합하되 신규 캐릭터마다 최소 두 축을 기존 인원과 다르게 한다.

## Components

- `DashboardView`, `AgentCardView`: 카드 계층과 상태/행동.
- `CozyAgentAvatarView`, `AgentPortraitView`, `SpriteLoader`: 동일 캐릭터의 pose별 자산.
- Asset ownership: `Resources/cozy/rooms`, `Resources/cozy/props`, `Resources/cozy/characters`.

## Accessibility

- 상태는 색만으로 전달하지 않고 이름·텍스트·아이콘을 함께 제공한다.
- 키보드 포커스와 VoiceOver용 이름/상태 설명을 유지한다.
- 텍스트 최소 크기와 명암 대비를 축소 뷰에서도 보존한다.
- Reduce Motion에서 움직임을 제거해도 상태 변화가 이해되어야 한다.

## Interaction states

- Loading/offline/error는 기존 콘솔 상태 표현을 유지한다.
- Agent states: waiting, inProgress, awaitingApproval, awaitingIntegration, completed, failed.
- pose 자산이 없으면 동일 스타일의 idle 자산으로 fallback하되 개발 로그에 누락을 남긴다.

## Content voice

- 짧고 친근한 한국어. 역할명과 명령어 같은 실제 식별자는 원문을 유지한다.
- 상태 문구는 감성 문구보다 현재 행동을 먼저 설명한다.

## Implementation constraints

- 캐릭터 PNG는 실제 alpha channel과 투명 모서리를 가져야 한다.
- 변경 후 `swift run ConsoleCoreTests`, `swift build`, asset/color/render check와 루트 `pnpm lint:check`, `pnpm test`, `pnpm build`를 통과한다.
