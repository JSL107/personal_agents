# 3D 원화 제작 규격과 프롬프트

대시보드·에이전트 카드의 캐릭터 원화와 부서 방 배경을 새로 받을 때 쓰는 문서입니다.
받은 파일은 남은 화면의 아바타와 강조 그림에서 사용합니다.

---

## 1. 캐릭터 원화 공통 규격

| 항목 | 값 | 안 지키면 |
|---|---|---|
| 캐릭터 캔버스 | **750 × 900 px**, RGBA | 다른 크기면 키가 사람마다 달라집니다(예전에 21% 차이가 났습니다) |
| 배경 | **완전 투명**(알파 0) | 방 배경 위에 네모난 판이 얹힙니다 |
| 바닥 그림자 | **그리지 않습니다** | 앱이 접지 그림자를 따로 그립니다. 그림에 있으면 두 겹이 됩니다 |
| 가구·소품 | **그리지 않습니다**(손에 드는 물건은 예외) | 카드에서 인물 식별을 방해합니다 |
| 시점 | 정면에서 살짝 위 — 방 그림의 3/4 하이앵글과 맞춥니다 | 사람만 다른 각도로 서 있게 됩니다 |
| 조명 | 왼쪽 위에서 오는 따뜻한 크림색 주광 + 부드러운 채움광 | 방 조명과 어긋나 오려 붙인 것처럼 보입니다 |
| 재질 | 매끈한 비닐 장난감 질감, 부드러운 3D 음영 | 다른 캐릭터와 이질적으로 보입니다 |
| 머리 비율 | 전체 키의 **40~45%** | 옆 사람과 나란히 섰을 때 종족이 달라 보입니다 |
| 눈 | 크고 단순한 형태, 광택 하이라이트 | 같은 이유 |
| 프레임 채움 | 세로 기준 약 90%, 가운데 정렬 | 앱이 여백을 잘라 쓰므로 편차가 크면 키가 흔들립니다 |

부서 방 배경(`rooms/*-shell.png`)은 1400 × 900 불투명 그림입니다.

---

## 2. 복사해 쓰는 캐릭터 프롬프트

### 2-1. 공통 머리말 (모든 캐릭터 프롬프트 앞에 붙입니다)

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

### 2-2. 같은 사람으로 유지하는 법

새 포즈를 만들 때는 **그 사람의 기존 그림을 참조 이미지로 함께 넣고** 아래를 덧붙입니다.
넣지 않으면 머리 모양과 옷이 매번 달라져 다른 사람이 됩니다.

```
Keep the exact same character as the reference image: identical hairstyle, hair
color, face, outfit, colors and accessories. Only the pose changes.
```

참조로 쓸 파일은 `Resources/cozy/characters/agent-<번호>.png`(기본 서 있는 그림)입니다.

### 2-3. 포즈별 본문

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

## 3. 앱에 붙이기

캐릭터 그림은 `Sources/IdaeriConsole/Resources/cozy/characters/agent-<번호>-<포즈>.png`에 둡니다.
기본 서 있는 그림은 포즈 이름 없이 `agent-<번호>.png`입니다. 부서 방 배경은
`Resources/cozy/rooms/<부서>-shell.png`, 카드 강조 그림은
`Resources/cozy/props/<부서>-accent.png`를 사용합니다.

새 포즈를 추가하면 `Sources/ConsoleCore/CozyPose.swift`의 포즈 이름·대체 순서·자세 계약과
`Sources/IdaeriConsole/CozyAssetCheck.swift`의 에셋 검사를 함께 갱신합니다.

```bash
cd clients/idaeri-console
swift run ConsoleCoreTests
swift run IdaeriConsole --asset-check
swift run IdaeriConsole --render-dashboard /tmp/dashboard.png
```
