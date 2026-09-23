# 3D 원화 제작 규격과 프롬프트

오피스 화면과 대시보드가 쓰는 **3D 원화**(`Resources/cozy/`)를 이미지 생성 AI로 새로 받을 때
쓰는 문서입니다. 그대로 복사해 넣을 수 있는 프롬프트와, 받은 파일을 앱에 붙이는 절차를 담았습니다.

> 도트 스프라이트 시트(`Resources/sprites/`)는 다른 규격입니다 — [ASSET-SHEET-SPEC.md](./ASSET-SHEET-SPEC.md)를 보세요.
> 지금 화면에 실제로 보이는 것은 대부분 이 문서가 다루는 3D 원화 쪽입니다.

---

## 1. 지금 필요한 것 (우선순위 순)

### 1순위 — 테이블 앞 착석에서 의자가 따라오는 문제

회의 테이블·응접 테이블 앞에 앉은 사람이 **자기 사무용 의자를 끌고 와서 앉습니다.**
`agent-N-sit-table.png` 20장이 전부 의자까지 함께 그려진 그림이기 때문입니다.

테이블 원화에서 의자를 일부러 지운 적이 있고(상판만 남기면 사람이 잘 보인다는 판단),
그 대신 사람 쪽 그림이 의자를 들고 오게 된 것이 지금 상태입니다.

**두 가지 길이 있고, 첫 번째를 권합니다.**

| | 만들 에셋 | 장점 | 단점 |
|---|---|---|---|
| **A안 (권장)** | 회의 테이블 1장 + 커피 테이블 1장 | **2장이면 끝납니다.** 빈 의자가 보여 "회의하는 방"으로 읽힙니다 | 앉은 사람 손이 무릎 위에 있어 "일하는" 느낌은 약합니다 |
| B안 | `sit-table` 20장 재제작 | 팔을 상판에 올린 자세라 회의 장면이 살아납니다 | 20장이고, 사람이 늘 때마다 다시 그려야 합니다 |

A안을 고르면 캐릭터는 이미 있는 `sitting`(의자 없이 앉은 전신) 그림을 그대로 씁니다.
두 안 모두 **에셋이 먼저 들어와야 코드를 바꿀 수 있습니다** — 순서를 뒤집으면
사람이 허공에 앉은 그림이 됩니다(실제로 한 번 그렇게 됐습니다).

### 2순위 — 포즈가 빈 사람들

같은 동작을 해도 그림이 있는 사람과 없는 사람이 갈립니다. 없는 사람은 비슷한 다른 그림으로
대체되거나, 대체할 것도 없으면 그냥 서 있는 기본 그림으로 떨어집니다.

| 포즈 | 지금 | 빠진 인덱스 |
|---|---|---|
| `typing` (책상 작업) | 10 / 20 | 6, 7, 8, 10, 11, 12, 14, 15, 16, 19 |
| `reading` (책 읽기) | 5 / 20 | 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18 |
| `writing` (서류 작성) | 4 / 20 | 2~5, 7~15, 17~19 |
| `drinking` (음료) | 4 / 20 | 2~7, 9~16, 18, 19 |

### 3순위 — 아직 그림이 하나도 없는 동작

코드에는 자리가 있는데 그림이 없어, 화면에서는 그냥 서 있는 사람으로 보입니다.
**상호작용을 늘리고 싶다면 여기가 가장 효과가 큽니다.**

- `tending` — 화분에 물 주기 (화분 앞에서)
- `carryingPapers` — 서류 뭉치를 안고 이동
- `stowing` — 캐비닛·책장에 물건 넣고 빼기

---

## 2. 모든 원화가 지켜야 할 공통 규격

| 항목 | 값 | 안 지키면 |
|---|---|---|
| 캐릭터 캔버스 | **750 × 900 px**, RGBA | 다른 크기면 키가 사람마다 달라집니다(예전에 21% 차이가 났습니다) |
| 배경 | **완전 투명**(알파 0) | 방 배경 위에 네모난 판이 얹힙니다 |
| 바닥 그림자 | **그리지 않습니다** | 앱이 접지 그림자를 따로 그립니다. 그림에 있으면 두 겹이 됩니다 |
| 가구·소품 | **그리지 않습니다**(손에 드는 물건은 예외) | 씬이 놓은 가구와 겹쳐 물건이 두 개로 보입니다 |
| 시점 | 정면에서 살짝 위 — 방 그림의 3/4 하이앵글과 맞춥니다 | 사람만 다른 각도로 서 있게 됩니다 |
| 조명 | 왼쪽 위에서 오는 따뜻한 크림색 주광 + 부드러운 채움광 | 방 조명과 어긋나 오려 붙인 것처럼 보입니다 |
| 재질 | 매끈한 비닐 장난감 질감, 부드러운 3D 음영 | 다른 캐릭터와 이질적으로 보입니다 |
| 머리 비율 | 전체 키의 **40~45%** | 옆 사람과 나란히 섰을 때 종족이 달라 보입니다 |
| 눈 | 크고 단순한 형태, 광택 하이라이트 | 같은 이유 |
| 프레임 채움 | 세로 기준 약 90%, 가운데 정렬 | 앱이 여백을 잘라 쓰므로 편차가 크면 키가 흔들립니다 |

가구·소품 원화는 캔버스 크기가 자유롭지만(현재 1000~1500px 사이) **투명 배경과 그림자 금지는
똑같이 적용**됩니다. 방 배경(`rooms/*.png`)만 예외로 1400 × 900 불투명입니다.

---

## 3. 복사해 쓰는 프롬프트

### 3-1. 공통 머리말 (모든 캐릭터 프롬프트 앞에 붙입니다)

```
A 3D-rendered chibi office character in a soft vinyl-toy style.
Head is about 40-45% of total body height. Large, simple, glossy eyes with a
bright highlight. Short rounded limbs. Smooth matte-vinyl material with gentle
subsurface softness. Warm cream key light from the upper left, soft ambient fill,
no harsh or dark shadows. Camera is slightly above eye level, looking down at a
gentle three-quarter high angle.

Full body visible and centered. Transparent background (alpha), 750x900 canvas,
the character fills about 90% of the frame height.

Do not draw any ground shadow. Do not draw any furniture, floor, wall or
background element. Do not add text or watermarks.
```

### 3-2. 같은 사람으로 유지하는 법

새 포즈를 만들 때는 **그 사람의 기존 그림을 참조 이미지로 함께 넣고** 아래를 덧붙입니다.
넣지 않으면 머리 모양과 옷이 매번 달라져 다른 사람이 됩니다.

```
Keep the exact same character as the reference image: identical hairstyle, hair
color, face, outfit, colors and accessories. Only the pose changes.
```

참조로 쓸 파일은 `Resources/cozy/characters/agent-<번호>.png`(기본 서 있는 그림)입니다.

### 3-3. 포즈별 본문

공통 머리말 + 유지 문구 뒤에 아래 한 덩어리를 붙입니다.

**`sit-table` — 테이블 앞 착석 (B안을 고를 때만)**

```
Pose: seated as if on a chair that is not drawn. Knees bent at about 90 degrees,
both feet flat on the ground, back upright, upper body leaning very slightly
forward. Both forearms rest on an invisible table surface at chest height, hands
relaxed and slightly apart. Calm, attentive expression.

Critical: no chair, no stool, no table, no desk. Nothing under or behind the
character. The character must read as seated even with all furniture removed.
```

**`typing` — 책상 작업**

```
Pose: seated at a desk that is not drawn, both arms extended forward and slightly
down, hands positioned as if resting on a keyboard, shoulders relaxed, eyes
looking forward and slightly down. Focused, pleasant expression.

Critical: no desk, no chair, no keyboard, no monitor. Only the character.
```

**`reading` — 책 읽기**

```
Pose: standing, holding an open book with both hands at chest height, head tilted
slightly down toward the pages, weight on one leg. Absorbed, calm expression.
The book is the only object allowed; draw it in warm muted colors.
```

**`writing` — 서류 작성**

```
Pose: standing, holding a clipboard or small notepad in one hand at chest height
and a pen in the other, mid-writing. Head tilted slightly down. Focused
expression. The clipboard and pen are the only objects allowed.
```

**`drinking` — 음료**

```
Pose: standing, holding a warm mug with both hands near the chest, head slightly
tilted, eyes softly closed or half closed. Relaxed, content expression. The mug
is the only object allowed.
```

**`tending` — 화분 물주기 (신규)**

```
Pose: standing, leaning slightly forward, holding a small watering can with both
hands and tilting it forward as if watering a plant. Gentle, caring expression.
The watering can is the only object allowed — do not draw the plant or the pot,
the scene already has one.
```

**`carryingPapers` — 서류 나르기 (신규)**

```
Pose: standing mid-stride, hugging a tall stack of documents and folders against
the chest with both arms, chin slightly raised to see over the stack. Busy but
cheerful expression. The document stack is the only object allowed.
```

**`stowing` — 정리 (신규)**

```
Pose: standing, one arm reaching forward and upward as if sliding a file onto a
shelf just above shoulder height, the other arm holding two folders at the waist.
Body turned slightly to the side, eyes following the reaching hand.
The files and folders are the only objects allowed — do not draw the shelf.
```

### 3-4. 가구 — 의자가 있는 회의 테이블 (A안)

```
A 3D-rendered oval meeting table in a soft vinyl-toy style, light warm oak wood,
rounded edges, two cylindrical pedestal legs. Six simple wooden chairs tucked in
around the table, evenly spaced, their backrests visible above the tabletop.
Same soft matte-vinyl material and warm cream lighting as the table.

Viewed from a gentle three-quarter high angle, slightly above the tabletop.
Transparent background (alpha). No ground shadow, no floor, no wall, no glow or
halo around the object. No text.
```

커피 테이블(응접용)은 같은 프롬프트에서 `oval meeting table` → `low round coffee table`,
`Six simple wooden chairs` → `two small armchairs`로 바꿔 씁니다.

> 지금 들어 있는 `meeting-table.png`에는 물체 둘레에 옅은 노란 잔광이 남아 있습니다.
> 새로 받을 때 `no glow or halo` 를 빼지 마세요.

---

## 4. 받은 파일을 앱에 붙이기

### 4-1. 파일 놓는 자리와 이름

| 종류 | 위치 | 이름 |
|---|---|---|
| 캐릭터 포즈 | `Sources/IdaeriConsole/Resources/cozy/characters/` | `agent-<0~19>-<포즈>.png` |
| 가구 | `Sources/IdaeriConsole/Resources/cozy/furniture-3d/` | `<가구이름>.png` |
| 방 배경 | `Sources/IdaeriConsole/Resources/cozy/rooms/` | `<부서>-shell.png` |
| 카드 소품 | `Sources/IdaeriConsole/Resources/cozy/props/` | `<부서>-accent.png` |

기본 서 있는 그림만 `agent-<번호>.png`로 포즈 이름 없이 둡니다.

### 4-2. 파일만 넣어서는 화면이 바뀌지 않습니다

**새 포즈**를 추가할 때는 아래를 함께 고쳐야 합니다. 한 곳만 빠뜨려도 파일도 있고 계약도
맞는데 화면만 그대로인 상태가 되고, 이 사고가 지금까지 세 번 났습니다.

1. `Sources/ConsoleCore/OfficeChoreography.swift`
   - `normalizedCozyPose` — 요청 이름을 파일 이름으로 접는 표
   - `cozyPoseCandidates` — 그 포즈가 없을 때 대신 쓸 순서
   - `cozyPosePosture` — 앉은 그림인지 선 그림인지
   - `cozySeatedPoseNames` — 앉은 자세라면 여기에도
2. `Sources/IdaeriConsole/CozyAssetCheck.swift` — 번들에 파일이 있는지 보는 게이트
3. 앉는 연출이라면 `Sources/ConsoleCore/OfficeIdle.swift`의 `OfficeInteractionPose`

**새 가구**로 상호작용을 늘릴 때는 아래가 한 벌입니다.

1. `Sources/ConsoleCore/OfficeFloorPlan.swift`
   - `FurnitureKind`에 종류 추가
   - `officeCozyDrawnFurnitureKinds`에 등록 — 빠지면 방 배경이 그린 것으로 간주해 안 그립니다
   - `departmentFurnitureSpots`에 놓을 자리
2. `Sources/ConsoleCore/OfficeIdle.swift`
   - `strollDwellSeconds` — 그 앞에 몇 초 머무는지. 값이 없으면 **배회 목적지가 되지 않습니다**
   - `interactionPose` — 그 앞에서 취할 자세
3. `Sources/IdaeriConsole/SpriteLoader.swift` — 파일 이름 연결
4. `Sources/IdaeriConsole/CozyAssetCheck.swift` — 게이트 목록

### 4-3. 확인

```bash
cd clients/idaeri-console
swift run ConsoleCoreTests                      # 전부 exit 0 이어야 합니다
swift run IdaeriConsole --render /tmp/office.png --populated-demo --size 2000x1250 --hour 14
swift run IdaeriConsole --render /tmp/poses.png --pose-demo --size 2000x1250
```

`--pose-demo`는 가구 앞 자세를 전부 강제로 세워 굽습니다. 새 포즈가 실제로 뽑히는지는
**그림을 눈으로 봐야** 알 수 있습니다 — 게이트는 파일이 있는지만 보고, 대체 그림으로
조용히 떨어진 경우도 그대로 통과합니다.
