# 오피스 스프라이트 시트 제작 규격

외부 이미지 생성 AI로 새 에셋 시트를 받을 때 지켜야 할 규격과, 받은 뒤 앱에 붙이는 절차.

## 전체 흐름

```
raw/<시트이름>.png  →  scripts/build-sprites.py  →  sprites/<스프라이트>.png  →  앱 번들
   (생성 AI 산출물)         (셀 분리·축소·배경제거)         (커밋 대상)
```

`raw/`는 재생성 입력이라 앱 번들에서 제외됩니다. 시트를 새로 받으면 `raw/`에 넣고 스크립트를
한 번 돌리면 됩니다.

```bash
cd clients/idaeri-console
python3 scripts/build-sprites.py     # 의존성: pip install pillow
```

---

## 모든 시트가 지켜야 할 공통 규격

| 항목 | 값 | 안 지키면 |
|---|---|---|
| 배경색 | 순수 마젠타 `#FF00FF` 단색 | 배경이 안 지워지고 오브젝트에 분홍 테두리가 남습니다 |
| 배경 그라데이션·그림자 | **금지** | 배경 판정(`R>200, B>200, G<90`)을 빠져나가 얼룩으로 남습니다 |
| 도트 크기 | 1 도트 = **정확히 8 픽셀** | 8의 배수가 아니면 축소 후 도트 폭이 들쭉날쭉해져 픽셀아트 질감이 깨집니다 |
| 안티에일리어싱 | **금지** (하드 엣지) | 경계가 뭉개집니다 |
| 오브젝트 간격 | 최소 40 픽셀 이상 마젠타로 완전 분리 | 두 물건이 한 덩어리로 검출돼 하나의 스프라이트로 잘립니다 |
| 화풍 | 굵은 어두운 외곽선 + 셀 셰이딩(재질당 2~3단계) | 기존 가구와 이질적으로 보입니다 |
| 시점 | 위에서 비스듬히 내려다보는 탑다운 | — |

### 셀이 잘리는 순서 (중요)

스크립트는 오브젝트를 **위→아래 행, 행 안에서는 왼→오른쪽** 순으로 읽어 이름을 붙입니다.
행 구분은 "평균 오브젝트 높이의 60%" 를 기준으로 묶기 때문에, **한 행 안의 오브젝트 높이가
들쑥날쑥하면 행 판정이 흔들려 순서가 뒤바뀝니다.**

- 행마다 비슷한 높이의 물건을 모아 주세요.
- 행과 행 사이는 넉넉히 띄워 주세요.
- 검출된 셀 개수와 이름 개수가 다르면 스크립트가 경고를 내고 멈춥니다(조용히 어긋나지 않음).

---

## 1. 캐릭터 시트

### 파일명

`raw/character-e.png`, `raw/character-f.png` … (`character-` 뒤에 알파벳 순서로)

현재 `character-base`, `character-b`, `character-c`, `character-d` 4장이 있습니다.

### 캔버스

**1983 × 793 픽셀**, 가로 한 줄에 포즈 5개.

### 포즈 순서 (왼쪽부터)

1. 정면 — 보는 사람 쪽을 향해 서 있음
2. 후면 — 등을 보이고 서 있음
3. 좌측면 — 왼쪽을 보고 서 있음
4. 우측면 — 오른쪽을 보고 서 있음 *(잘라내지만 자리는 채워야 순서가 맞습니다)*
5. 앉은 자세 — 사무용 의자에 앉아 정면을 봄 (의자 포함)

### 색 규약 — 이걸 어기면 리컬러가 깨집니다

앱은 사람마다 머리·셔츠·바지 색을 **코드에서 갈아끼워** 29명을 서로 다른 사람으로 보이게 합니다.
부위 구분을 **밝기와 채도로** 하기 때문에 아래 조건이 지켜져야 합니다.

| 부위 | 요구 조건 | 근거 |
|---|---|---|
| 셔츠 | 순백에 가까운 무채색 (RGB 각 235 이상) | 밝기 228 이상을 셔츠로 판정 |
| 바지 | 거의 검정인 무채색 (RGB 각 20 이하) | 밝기 24 이하를 바지로 판정 |
| 머리 | 중간~어두운 회색 무채색 (RGB 각 45~105), **키의 위쪽 45% 안에만** | 밝기 40~110 + 위치 조건 |
| 피부 | 채도가 뚜렷한 살색 | 채도 26 이상이면 색을 안 바꿉니다 |
| 신발·소품 | 채도가 있는 색 (회색·흰색·검정 금지) | 위와 같음 |

**핵심**: 캐릭터 몸에 위 세 가지(흰색·검정·회색) 외의 무채색을 쓰지 마세요. 회색 넥타이나
흰 운동화를 넣으면 그게 셔츠나 바지로 인식돼 엉뚱한 곳의 색이 바뀝니다.

### 걸음 애니메이션 조건

걷는 그림은 따로 그리지 않고 **정지 그림의 다리를 코드가 변형해** 만듭니다. 그러려면:

- **정면·후면 포즈는 두 다리 사이에 배경이 비치는 틈이 반드시 있어야 합니다.** 다리가 붙어
  있으면 걸음 프레임이 만들어지지 않고, 그 사람은 걷는 동안 기본 캐릭터로 바뀝니다.
- 측면은 다리가 겹쳐도 됩니다(다른 방식으로 처리).

### 프롬프트 (그대로 복사해 쓰세요)

```
Pixel art character sheet for a cozy office simulation game, top-down-ish front view.

Background: solid pure magenta #FF00FF, completely flat, no gradient, no shadow, no
vignette. Characters must never touch each other — leave wide magenta gaps between poses.

Canvas: 1983 x 793 pixels. Five poses in ONE horizontal row, evenly spaced, in this
exact order, left to right:
1. standing, facing the viewer (front view)
2. standing, seen from behind (back view)
3. standing in profile, facing LEFT
4. standing in profile, facing RIGHT
5. sitting on a dark office chair, facing the viewer (chair included)

Character design: chibi office worker, oversized head, small body, roughly 3.5 heads
tall, friendly simple face, standing height about 430 pixels.

Rendering: clean pixel art where 1 logical pixel equals exactly 8 screen pixels. Hard
edges only, absolutely no anti-aliasing, no blur, no dithering. Bold dark outline around
every shape. Simple cel shading with 2-3 flat shades per material.

STRICT COLOR RULES — an automated recolor script depends on these, do not deviate:
- Shirt / top: pure white or near-white, fully desaturated (each RGB channel >= 235)
- Trousers / lower body: near-black, fully desaturated (each RGB channel <= 20)
- Hair: neutral mid-to-dark gray, fully desaturated (each RGB channel between 45 and
  105), and hair must exist ONLY in the top 45% of the character's height
- Skin: clearly saturated warm skin tone (never gray)
- Shoes: saturated brown (never gray, white or black)
- Do NOT use any other white, black or gray material anywhere on the character —
  no gray tie, no white sneakers, no black bag, no gray glasses frame.

In the front and back poses, the two legs MUST be separated by a visible gap of
magenta background between them.
```

### 사람마다 다르게 만들려면

같은 프롬프트에 아래 한 줄만 바꿔 넣으면 다른 사람이 나옵니다. **색 규약은 그대로 두세요** —
바뀌는 건 얼굴·체형·헤어스타일이고, 색은 어차피 코드가 갈아끼웁니다.

```
Character variation: young woman with a long ponytail, slim build
Character variation: middle-aged man with short spiky hair, stocky build, glasses
Character variation: woman with a short bob cut, average build
Character variation: tall thin man with wavy hair
```

### 받은 뒤 코드 변경 (3곳)

**1)** `scripts/build-sprites.py` 의 `SHEETS` 에 한 줄 추가

```python
"character-e": ["chare-down", "chare-up", "chare-side", None, "chare-sit"],
```

**2)** `Sources/ConsoleCore/AgentRole.swift` 의 `characterSheetPrefixes` 에 접두어 추가

```swift
public let characterSheetPrefixes = ["char", "charb", "charc", "chard", "chare"]
```

**3)** `Sources/ConsoleCoreTests/OfficeChoreographyTests.swift` 의 걸음 프레임 개수 갱신

```swift
// 시트 수 × 3포즈 × 2프레임
t.expectEqual(expectedFrames.count, 30, "걸음 프레임 30장 ...")
```

이 숫자는 일부러 못박아 둔 것입니다 — 시트를 늘리면 테스트가 걸리고, 그 김에 "에셋을
실제로 다 만들었는지" 검사가 함께 돌아갑니다. 시트 하나당 6장(3포즈 × 2프레임)씩 늘립니다.

**1)·2) 중 하나만 고치면 조용히 어긋납니다** — 2)를 빼먹으면 스프라이트 파일은 만들어지는데
아무도 그 시트를 배정받지 않아, 에러 없이 새 캐릭터가 화면에 안 나옵니다. 실제로 한 번
겪은 함정입니다.

---

## 2. 가구·소품 시트

### 파일명

`raw/furniture-2.png` (기존 `furniture.png` 는 그대로 두고 새 시트로 추가)

### 크기 기준

바닥 타일 한 칸이 약 **40 도트 = 320 픽셀**입니다. 이걸 기준으로:

| 물건 | 도트 크기 | 캔버스 픽셀 |
|---|---|---|
| 책상 (기존) | 37 × 32 | 296 × 256 |
| 책장 (기존) | 37 × 35 | 296 × 280 |
| 시계 (기존) | 20 × 19 | 160 × 152 |
| 러그 (2×2 칸) | 80 × 80 | 640 × 640 |
| 문 (1칸 폭) | 40 × 45 | 320 × 360 |
| 액자·포스터 | 20 × 16 | 160 × 128 |
| 서류 캐비닛 | 30 × 34 | 240 × 272 |

### 가로세로비가 왜 중요한가 (해결됨 — `furniture-3`)

가구 크기는 코드가 "실물 높이(cm) → 픽셀"로 환산해 맞춥니다(`FurnitureKind.targetHeightCm`).
그런데 배율은 가로·세로에 함께 곱해지므로, **그림 자체가 실물보다 납작하면 높이를 맞추는 순간
폭이 옆 칸을 침범합니다.** 그래서 폭 상한(`officeFurnitureWidthCapTiles`, 1.15칸)에 걸려
목표 높이를 다 못 채우는 물건이 있었고, `raw/furniture-3.png`로 세 종을 다시 뽑아 해소했습니다.

| 물건 | 예전 | 문제였던 것 | 지금 | 결과 |
|---|---|---|---|---|
| **문** | 40 × 45 | 목표의 81%. 사람(1.35칸)보다 낮아 **사람이 문보다 컸습니다** | 35 × 64 | 1.59칸 (100%) |
| **화이트보드** | 39 × 22 | 목표의 68%. 보드가 이젤 상판처럼 납작 | 55 × 56 | 0.95칸 (100%) |
| **책장** | 37 × 35 | 목표의 91%. 3단인데 거의 정사각형 | 37 × 59 | 1.19칸 (100%) |

**절대 크기는 주문과 달라도 됩니다.** 코드가 실물 높이로 환산하므로 중요한 것은 가로세로비뿐입니다
— 위 표의 "지금" 열은 주문서(40×80 등)와 다르지만 비율이 맞아 목표를 100% 채웁니다.

교훈 두 가지:

- **문 열림·닫힘 두 장은 높이가 같아야 합니다.** 실제로는 64와 67로 3도트 어긋나, 문이 열릴 때
  5% 커집니다. 배율 계산에 쓰는 `nativeSize`는 닫힌 문 기준 하나만 두었습니다(두 값을 따로 두면
  서로 다른 배율을 받아 차이가 오히려 커집니다).
- **그림이 무엇을 담고 있는지가 배치를 바꿉니다.** 재제작한 화이트보드는 스탠드와 바퀴까지 담은
  이동식이라 벽에 걸 수 없습니다. `isWallMounted` 로 두었더니 벽 줄에서 세로로 자라 바깥벽을
  뚫고 화면 밖으로 잘렸습니다. 벽에 거는 판은 `wallWhiteboard`(39×24)가 따로 있습니다.

#### 주문서 — `raw/furniture-3.png`

기존 시트는 그대로 두고 새 시트로 받습니다. 셀 넷을 두 행으로 나눕니다(문 두 장이 훨씬 높아
같은 행에 두면 행 판정이 흔들립니다).

| 셀 | 물건 | 도트 | 캔버스 픽셀 |
|---|---|---|---|
| Row 1 좌 | 닫힌 문 | 40 × 80 | 320 × 640 |
| Row 1 우 | 열린 문(안쪽으로 열려 통로가 보임) | 40 × 80 | 320 × 640 |
| Row 2 좌 | 3단 책장 | 30 × 45 | 240 × 360 |
| Row 2 우 | 이동식 화이트보드 | 34 × 34 | 272 × 272 |

아래 프롬프트를 공통 규격(§모든 시트가 지켜야 할 공통 규격)과 함께 그대로 씁니다.

```
Objects, in this exact order, left to right then top to bottom:

Row 1: a CLOSED wooden office door seen straight from the front, including the frame —
       tall and narrow, roughly 320 pixels wide by 640 pixels tall, with a small frosted
       glass window in the upper half and a metal handle on the right;
       the SAME door OPEN, swung inward so a dark empty doorway is visible beside the
       door leaf, same overall footprint of 320 x 640 pixels
Row 2: a three-shelf wooden bookcase seen from the front, clearly TALLER than wide
       (240 pixels wide by 360 pixels tall), books of muted colours on every shelf;
       a mobile whiteboard on a metal stand seen from the front, the board itself nearly
       square (272 x 272 pixels), white surface with a thin marker tray at the bottom

The two doors in Row 1 must be the same height as each other. The bookcase and the
whiteboard in Row 2 must be similar in height to each other.
```

받은 뒤 코드 변경:

1. `scripts/build-sprites.py` 의 `SHEETS` 에 추가
   ```python
   "furniture-3": ["furn-door-closed", "furn-door-open", "furn-bookshelf", "furn-whiteboard"],
   ```
   이름이 기존과 같으므로 **기존 스프라이트를 덮어씁니다.** `furniture` · `furniture-door`
   시트의 해당 셀 이름을 `None` 으로 바꿔 두 시트가 같은 파일을 다투지 않게 하세요.
2. `Sources/ConsoleCore/OfficeFloorPlan.swift` 의 `nativeSize` 실측값을 **잘려 나온 실제
   크기로** 갱신 — 주문한 값이 아닙니다. 생성 AI 는 캔버스 크기를 정확히 맞추지 않으므로
   `sips -g pixelWidth -g pixelHeight sprites/<이름>.png` 로 재서 넣습니다
   (이번에는 문 35×64, 책장 37×59, 화이트보드 55×56 이 나왔습니다)
3. 테스트를 돌려 폭 상한에 안 걸리는지 확인 — 문은 목표 배율 1.41 이 그대로 반영돼야 합니다
   (`swift run ConsoleCoreTests`)

### 그 밖의 추천 품목

1. **액자·포스터·화이트보드(글씨 있는 버전)** — 벽이 비어 있습니다
2. **소파 코너 조각** — 응접 세트를 L자로 놓을 수 있게
3. **회의 테이블 의자 세트** — 지금 회의실 테이블은 의자가 붙어 있는 한 장입니다

### 프롬프트

```
Pixel art office furniture sprite sheet, top-down-ish view, for a cozy office
simulation game.

Background: solid pure magenta #FF00FF, completely flat, no gradient, no shadow.
Every object fully surrounded by magenta, with at least 60 pixels of empty magenta
between neighbouring objects.

Layout: arrange objects in clean horizontal rows. Objects in the SAME row must have
similar heights. Leave generous vertical space between rows.

Rendering: clean pixel art where 1 logical pixel equals exactly 8 screen pixels. Hard
edges only, no anti-aliasing, no blur, no dithering. Bold dark outline around every
object. Simple cel shading with 2-3 flat shades per material. Muted, slightly desaturated
office palette — warm wood browns, cool grays, muted purple upholstery.

Objects, in this exact order, left to right then top to bottom:
[여기에 품목을 순서대로 나열]

Scale reference: a desk is 296 pixels wide, a wall clock is 160 pixels wide, one floor
tile is 320 pixels.
```

`[여기에 품목을 순서대로 나열]` 자리에 예를 들면:

```
Row 1: a closed wooden office door seen from the front, a rolled-up floor rug (dark
       green with a pattern), a floor rug (warm beige with a pattern)
Row 2: a tall gray filing cabinet, a red vending machine, a small office refrigerator
Row 3: a framed picture for the wall, a motivational poster, a small wall shelf
```

### 받은 뒤 코드 변경 (2곳)

**1)** `scripts/build-sprites.py` 의 `SHEETS` 에 시트와 순서 추가

```python
"furniture-2": ["furn-door", "furn-rug-a", "furn-rug-b", "furn-cabinet", ...],
```

**2)** `Sources/ConsoleCore/OfficeFloorPlan.swift` 의 `FurnitureKind` 에 항목 추가 +
`Sources/IdaeriConsole/SpriteLoader.swift` 의 `furnitureSpriteName` 에 매핑 추가.

새 가구는 배치까지 해야 화면에 나옵니다(평면도 코드에서 어디에 놓을지 지정).

---

## 검수 체크리스트

시트를 받으면 스크립트를 돌리기 전에 눈으로 확인하세요.

- [ ] 배경이 단색 마젠타인가 (그라데이션·그림자 없음)
- [ ] 물건끼리 붙어 있지 않은가
- [ ] 같은 행의 물건 높이가 비슷한가
- [ ] 도트가 균일한가 (확대해서 계단이 일정한 폭인지)
- [ ] (캐릭터) 셔츠가 흰색, 바지가 검정, 머리가 회색인가
- [ ] (캐릭터) 몸에 다른 무채색 소품이 없는가
- [ ] (캐릭터) 정면·후면에서 두 다리 사이가 벌어져 있는가

스크립트를 돌린 뒤:

- [ ] 경고 없이 끝났는가 (`⚠️ 셀 N개 검출` 이 뜨면 셀 개수가 안 맞는 것)
- [ ] `sprites/` 에 생긴 파일의 크기가 위 표와 비슷한가
- [ ] (캐릭터) `-walk1`, `-walk2` 파일이 생겼는가 (없으면 다리 틈이 없다는 뜻)
