# 오피스 픽셀 화면 재정합 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 콘솔 오피스 화면의 스프라이트 규격을 32px 로 정합하고 팔레트를 양자화해 화면 고유색을 15,614 → 500 이하로 줄이며, 방을 눌러 크게 보는 2단 뷰를 추가한다.

**Architecture:** 에셋 파이프라인(`build-sprites.py`)에 32px 규격 스냅과 팔레트 양자화를 넣어 기존 `raw/` 에서 다시 굽고, 화면 타일 크기를 정수 배율(전체 32px · 방 64px)로 고정한다. 방 뷰는 `SKCameraNode` 를 도입하지 않고 기존 리사이즈 경로(타일 크기 + 격자 원점 재계산)를 재사용한다. 배율·원점 판정은 `ConsoleCore` 순수 함수로 두고 `OfficeScene` 이 실행한다.

**Tech Stack:** Swift 5.9 (SpriteKit · AppKit · SwiftUI), Python 3 + Pillow (에셋 파이프라인), 실행형 테스트 러너 `ConsoleCoreTests`(XCTest 없음)

**Spec:** `docs/superpowers/specs/2026-09-04-office-pixel-refit-design.md`

## Global Constraints

- **판정은 `ConsoleCore` 순수 함수, 실행은 `OfficeScene`.** `OfficeIdle` · `OfficeChoreography` · `OfficeAttendance` 가 이미 지키는 경계다.
- **시각은 예외 없이 `OfficeScene.currentHour()` 경유.** `Date()` 직접 호출은 `--hour` 렌더 검증을 무력화한다.
- **테스트는 XCTest 가 아니다.** `swift test` 는 실패한다. 스위트 함수를 만들고 `Sources/ConsoleCoreTests/main.swift` 에 `runXxxTests(runner)` 로 등록한 뒤 `swift run ConsoleCoreTests` 로 돌린다. 단정은 `t.expect(조건, "메시지")` · `t.expectEqual(실제, 기대, "메시지")`.
- **게이트(모든 태스크 끝에):** `swift build && swift run ConsoleCoreTests` · `pnpm lint:check && pnpm test && pnpm build`
- **렌더 검증은 두 창 비율 모두** — 실사용 창 `960x1050` 과 최소 창 `960x563`. 최소 창은 글자 하한 때문에 배치가 다르다.
- **사람이 나오는 렌더는 백엔드가 떠 있어야 한다.** 백엔드(포트 3099)가 꺼져 있으면 스냅샷이 빈 배열이라 방이 텅 빈 채로 그려지고, `--busy-demo` 는 `--busy-demo 는 사람이 있어야 한다 — 스냅샷이 비었다` 로 거부된다(2026-09-04 실측). 접속 주소는 `IDAERI_CONSOLE_URL` 이며 `PORT` 가 아니다. **빈 렌더로도 확인되는 것**(타일 규격·바닥·벽·문·색 수)과 **사람이 필요한 것**(이름표 겹침·말풍선·서류 더미·방 뷰의 좌석)을 구분해서, 후자는 백엔드를 띄운 뒤 한 번에 확인한다. 다만 검증용으로 Nest 전체를 부팅하면 실행 중 서비스의 반복 작업 등록을 건드릴 수 있으니, 이미 떠 있는 백엔드를 쓰고 없으면 사용자에게 요청한다.
- **작업 위치:** worktree `/Users/juneseok/Desktop/backend/worktrees/office-pixel-refit`, 브랜치 `feat/office-pixel-refit`. 커밋은 이 worktree 안에서만 하고 `main` 직접 커밋·force push 는 금지.
- **`docs/` 는 `.gitignore` 대상이다**(`.gitignore:9,78`). 스펙·계획 문서를 커밋할 때는 `git add -f` 를 쓴다.
- **에셋을 새로 뽑기 전에 코드로 그릴 수 있는지 본다.** 색·글자·빛은 코드가 싸다(`OfficeLightTexture` 선례).
- 격자 규격은 고정값이다 — `zoneWidth=10 · zoneHeight=7 · bandHeight=5 · zoneStride=12 · officeFloorWallRows=1`, 2열 배치에서 **23×27칸**.

---

### Task 1: 색 수 측정 도구와 기준선 고정

개선을 증명할 잣대를 먼저 만든다. 이것 없이 파이프라인을 고치면 나아졌는지 눈으로만 판정하게 된다.

**Files:**
- Create: `clients/idaeri-console/scripts/measure-palette.py`
- Create: `clients/idaeri-console/scripts/PALETTE-BASELINE.md`

**Interfaces:**
- Produces: `python3 scripts/measure-palette.py <경로...>` — PNG 파일이나 디렉터리를 받아 파일별 `크기 · 고유색 · 색/픽셀 비율` 을 출력하고, 마지막에 합계 줄을 낸다. Task 2 의 가드와 Task 3 의 검증이 이 출력을 기준으로 판정한다.

- [ ] **Step 1: 측정 스크립트를 만든다**

```python
#!/usr/bin/env python3
"""스프라이트·렌더 PNG 의 팔레트 상태를 재는 도구.

색 수가 많으면 도트가 뭉개져 있다는 뜻이다. 진짜 픽셀아트는 40x41 타일에 색이 10~20개고,
생성 AI 산출물을 축소한 것은 수백 개가 된다(2026-09-04 실측: tile-wood-b 865색).
"""
from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

from PIL import Image


def measure(path: Path) -> tuple[str, tuple[int, int], int, int]:
    """(이름, 크기, 불투명 픽셀의 고유색 수, 불투명 픽셀 수)."""
    image = Image.open(path).convert("RGBA")
    opaque = [pixel for pixel in image.getdata() if pixel[3] > 8]
    return path.name, image.size, len(set(opaque)), len(opaque)


def collect(targets: list[str]) -> list[Path]:
    paths: list[Path] = []
    for target in targets:
        root = Path(target)
        if root.is_dir():
            paths.extend(sorted(root.glob("*.png")))
        elif root.exists():
            paths.append(root)
        else:
            print(f"건너뜀 — {root} 없음", file=sys.stderr)
    return paths


def main(argv: list[str]) -> int:
    if not argv:
        print("사용법: measure-palette.py <PNG 또는 디렉터리>...", file=sys.stderr)
        return 2
    paths = collect(argv)
    if not paths:
        print("측정할 PNG 가 없다", file=sys.stderr)
        return 1
    print(f"{'파일':32} {'크기':12} {'고유색':>8} {'색/픽셀':>8}")
    worst = 0
    worst_name = ""
    for path in paths:
        name, size, colors, pixels = measure(path)
        ratio = colors / pixels if pixels else 0.0
        print(f"{name:32} {str(size):12} {colors:8} {ratio:8.2f}")
        if colors > worst:
            worst, worst_name = colors, name
    print(f"\n파일 {len(paths)}개 · 최다 색 {worst}개 ({worst_name})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
```

- [ ] **Step 2: 현재 스프라이트를 재서 도구가 동작하는지 확인한다**

Run: `cd clients/idaeri-console && python3 scripts/measure-palette.py Sources/IdaeriConsole/Resources/sprites`
Expected: 102개 파일이 출력되고, 마지막 줄의 최다 색이 800을 넘는다(`tile-wood-b.png` 865색 부근).

- [ ] **Step 3: 기준선 문서를 만든다**

Step 2 의 실제 출력에서 값을 옮겨 적는다. 아래는 2026-09-04 측정값이며, Step 2 의 결과가 다르면 실제 값으로 대체한다.

```markdown
# 팔레트 기준선 — 2026-09-04

`scripts/measure-palette.py` 로 측정. 재정합 전 상태를 고정해 개선분을 재는 잣대로 쓴다.

## 스프라이트 (`Resources/sprites`, 102개)

| 파일 | 크기 | 고유색 | 색/픽셀 |
|---|---|---|---|
| tile-wood-b.png | 39×41 | 865 | 0.54 |
| tile-wood-a.png | 39×41 | 814 | 0.51 |
| charc-sit.png | 24×56 | 776 | 0.71 |
| tile-carpet-dark.png | 40×41 | 630 | 0.38 |
| tile-carpet-light.png | 39×40 | 426 | 0.27 |
| furn-clock.png | 20×19 | 209 | 0.70 |
| tile-ceramic.png | 39×41 | 197 | 0.12 |
| tile-wall.png | 39×40 | 99 | 0.06 |
| prop-papers.png | 10×6 | 43 | 0.98 |
| desk-paper.png | 7×4 | 3 | 0.12 |

마지막 두 줄은 `draw-props.py` 가 도트로 직접 그린 것이라 깨끗하다 — 손상은 생성 AI 시트에서 온 것에 한정된다.

## 원본 시트 (`Resources/raw`)

| 시트 | 해상도 | 고유색 |
|---|---|---|
| furniture.png | 1254×1254 | 158,089 |
| furniture-4.png | 814×1931 | 104,170 |
| furniture-wall.png | 1600×1120 | 97,271 |
| character-base.png | 1983×793 | 45,683 |
| tiles-floor.png | 2172×724 | 38,085 |

## 화면 (오프스크린 렌더 `--size 1200x1000`)

| 항목 | 값 |
|---|---|
| 고유색 | 15,614 |
| 상위 40색 커버 | 83.1% |
| 비교: claude-office | 256 |

## 규격

타일 크기가 39×40 · 40×41 · 39×41 로 제각각이다. 원인은 `detect_cells` 의 bounding box 가
셀마다 몇 px 씩 다르고 `shrink()` 의 `//SCALE` 나눗셈이 그 차이를 그대로 넘기는 것,
그리고 타일만 가장자리 1px 을 더 잘라내는 것(`build-sprites.py` 의 `tile-` 분기)이다.

## 목표

- 스프라이트 파일당 고유색 64 이하
- 타일은 정확히 32×32
- 화면 고유색 500 이하
```

- [ ] **Step 4: 커밋**

```bash
cd /Users/juneseok/Desktop/backend/worktrees/office-pixel-refit
git add clients/idaeri-console/scripts/measure-palette.py
git add -f clients/idaeri-console/scripts/PALETTE-BASELINE.md
git commit -m "chore(console): 스프라이트 팔레트 측정 도구와 재정합 전 기준선"
```

---

### Task 2: 파이프라인에 32px 규격 스냅 · 팔레트 양자화 · 색 수 가드

에셋을 교체하지 않고도 개선분이 나오는 지점이다. 목표 규격을 32px 로 내리는 것이 Task 3(정수 배율)의 전제이기도 하다.

**Files:**
- Modify: `clients/idaeri-console/scripts/build-sprites.py` (`SCALE` 부근 상수 · `shrink()` 222-229 · `main()` 저장 루프 453-476)
- Modify: `clients/idaeri-console/scripts/ASSET-SHEET-SPEC.md` (규격 32px · 색 상한 문단 추가)

**Interfaces:**
- Consumes: Task 1 의 `scripts/measure-palette.py`
- Produces: `TILE_PX = 32` (타일 한 칸의 목표 픽셀 수) · `PALETTE_MAX = 64` (스프라이트 1개의 색 상한) · `snap_to_grid(image, unit)` · `quantize_sprite(image, colors)`. Task 3 의 Swift 상수 `officeSpriteUnit = 32` 가 이 값과 짝이다.

- [ ] **Step 1: 규격 상수와 두 함수를 추가한다**

`SCALE = 8` 아래에 상수를, `shrink()` 아래에 함수 둘을 넣는다.

```python
# 타일 한 칸의 목표 픽셀 수. 화면 배율이 정수여야 도트가 깨지지 않는데, 정수 배수는 확대에만
# 쓸 수 있다 — 40px 에셋은 실사용 창(960x1050, 격자 23x27)에서 1배면 세로가 30px 넘치고
# 1/2배면 화면의 4분의 1만 쓴다. 그 사이가 비어 있어 규격을 32px 로 내린다.
TILE_PX = 32

# 스프라이트 1개의 색 상한. 생성 AI 시트는 도트 블록 안쪽에도 음영이 있어, 블록 중앙을
# 정확히 뽑아도 블록마다 색이 달라진다(재정합 전 tile-wood-b 865색). 양자화가 그 뒤를 받는다.
PALETTE_MAX = 64
```

```python
def snap_to_grid(image: Image.Image, unit: int) -> Image.Image:
    """짧은 변을 `unit` 의 정수배로 맞춘다. 타일이 39x41 처럼 흔들리는 것을 막는다.

    `detect_cells` 의 bounding box 가 셀마다 몇 px 씩 다르고 `shrink` 의 나눗셈이 그 차이를
    그대로 넘긴다. 반복해 깔리는 타일은 정확히 정수배여야 이음매가 맞는다.
    """
    width, height = image.size
    if width <= 0 or height <= 0:
        return image
    steps = max(round(min(width, height) / unit), 1)
    target_short = steps * unit
    scale = target_short / min(width, height)
    target = (max(round(width * scale), 1), max(round(height * scale), 1))
    if target == image.size:
        return image
    return image.resize(target, Image.NEAREST)


def quantize_sprite(image: Image.Image, colors: int) -> Image.Image:
    """색을 `colors` 개로 줄인다. 디더링은 끈다 — 켜면 점무늬가 생겨 도트가 다시 지저분해진다.

    알파는 양자화 대상이 아니다. RGB 만 줄인 뒤 원래 알파를 되돌려 붙인다.
    """
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    reduced = rgba.convert("RGB").quantize(
        colors=colors, method=Image.MEDIANCUT, dither=Image.Dither.NONE
    )
    result = reduced.convert("RGBA")
    result.putalpha(alpha)
    return result
```

- [ ] **Step 2: 저장 루프에 규격 스냅 · 양자화 · 가드를 끼운다**

`main()` 의 `sprite = trim(erode_fringe(strip_background(shrink(cell))))` 줄을 아래로 바꾼다.

```python
            sprite = trim(erode_fringe(strip_background(shrink(cell))))
            if name.startswith("tile-"):
                # 타일은 가장자리 1px 을 버린다. 잔여 제거가 못 걷어낸 경계 한 줄이 남으면
                # 반복해 깔았을 때 줄무늬로 보인다 — 패턴 타일이라 1px 손실은 티가 안 난다.
                sprite = sprite.crop(
                    (1, 1, max(sprite.width - 1, 2), max(sprite.height - 1, 2))
                )
                # 자른 뒤에 스냅한다 — 먼저 스냅하면 1px 손실이 규격을 다시 깨뜨린다.
                sprite = sprite.resize((TILE_PX, TILE_PX), Image.NEAREST)
            else:
                sprite = snap_to_grid(sprite, TILE_PX)
            sprite = quantize_sprite(sprite, PALETTE_MAX)
            colors = len({pixel for pixel in sprite.getdata() if pixel[3] > 8})
            if colors > PALETTE_MAX:
                print(f"✗ {name}: 색 {colors}개 — 상한 {PALETTE_MAX} 초과")
                return 1
            sprite.save(OUT / f"{name}.png")
```

기존 `tile-` 분기가 이 블록 안으로 들어가므로 **아래에 있던 원래 `tile-` 분기와 `sprite.save` 줄은 지운다**(중복 실행 방지).

- [ ] **Step 3: 재생성하고 색 수가 줄었는지 확인한다**

Run:
```bash
cd clients/idaeri-console
python3 scripts/build-sprites.py
python3 scripts/measure-palette.py Sources/IdaeriConsole/Resources/sprites
```
Expected: 종료 코드 0. 최다 색이 **64 이하**, 모든 `tile-*.png` 가 **32×32**. 기준선의 865색이 사라진다.

- [ ] **Step 4: 캐릭터 리컬러가 살아 있는지 확인한다**

리컬러는 밝기·채도로 머리·셔츠·바지를 가른다. 양자화가 그 경계를 흐리면 사람마다 색이 뒤섞인다.

Run: `swift build && swift run IdaeriConsole --render /tmp/refit-quant.png --hour 15 --size 1200x1000`
그리고 `python3 scripts/measure-palette.py /tmp/refit-quant.png`
Expected: 렌더 성공. 색 수가 기준선 15,614 에서 크게 줄어든다. 대표(`나 (대표)`) 캐릭터의 머리·셔츠·바지가 서로 다른 색으로 남아 있는지 눈으로 확인한다.

- [ ] **Step 5: 규격 문서를 갱신한다**

`ASSET-SHEET-SPEC.md` 에 "타일은 32×32 로 저장된다", "스프라이트 1개의 색 상한은 64이고 초과하면 빌드가 실패한다", "양자화는 디더링 없이 MEDIANCUT" 세 줄을 추가한다.

- [ ] **Step 6: 커밋**

```bash
git add clients/idaeri-console/scripts/build-sprites.py
git add clients/idaeri-console/Sources/IdaeriConsole/Resources/sprites
git add -f clients/idaeri-console/scripts/ASSET-SHEET-SPEC.md
git commit -m "fix(console): 39~41px 로 흔들리던 스프라이트 규격을 32px 로 스냅하고 팔레트를 64색으로 양자화"
```

---

### Task 3: 화면 타일을 정수 배율로 고정 (전체 뷰 32px)

**Files:**
- Create: `clients/idaeri-console/Sources/ConsoleCore/OfficeViewMetrics.swift`
- Create: `clients/idaeri-console/Sources/ConsoleCoreTests/OfficeViewMetricsTests.swift`
- Modify: `clients/idaeri-console/Sources/ConsoleCoreTests/main.swift` (스위트 등록)
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift:268-281` (`recalculateMetrics`)
- Modify: `clients/idaeri-console/Sources/ConsoleCore/OfficeFloorPlan.swift:39` (`officeReferenceTileSize`)

**Interfaces:**
- Consumes: Task 2 의 `TILE_PX = 32`
- Produces: `officeSpriteUnit: Double = 32` · `struct OfficeViewMetrics { tileSize, originX, originY }` · `officeViewMetrics(viewWidth:viewHeight:columns:rows:) -> OfficeViewMetrics`. Task 4 가 이 함수에 방 포커스 인자를 더한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`Sources/ConsoleCoreTests/OfficeViewMetricsTests.swift`:

```swift
import Foundation

@testable import ConsoleCore

func runOfficeViewMetricsTests(_ t: TestRunner) {
    t.suite("OfficeViewMetrics")

    // 실사용 창. 격자 23x27 에 32px 를 깔면 736x864 로 들어간다.
    let wide = officeViewMetrics(viewWidth: 960, viewHeight: 1050, columns: 23, rows: 27)
    t.expectEqual(wide.tileSize, 32, "실사용 창에서는 32px")

    // 최소 창. 27행 x 32px = 864 가 세로 563 을 넘으므로 한 단계 내려간다.
    let short = officeViewMetrics(viewWidth: 960, viewHeight: 563, columns: 23, rows: 27)
    t.expectEqual(short.tileSize, 16, "최소 창에서는 16px")

    // 배율은 언제나 스프라이트 단위의 정수배여야 한다 — 비정수로 그리면 도트가 불규칙하게 버려진다.
    for width in stride(from: 400.0, through: 2000.0, by: 37.0) {
        for height in stride(from: 300.0, through: 1600.0, by: 41.0) {
            let metrics = officeViewMetrics(
                viewWidth: width, viewHeight: height, columns: 23, rows: 27
            )
            let steps = metrics.tileSize / officeSpriteUnit
            t.expect(
                steps == steps.rounded() && steps >= 0.5,
                "타일 \(metrics.tileSize)px 가 \(officeSpriteUnit)px 의 정수배가 아니다"
                    + " (창 \(width)x\(height))"
            )
        }
    }

    // 격자는 화면 가운데에 놓인다.
    t.expectEqual(wide.originX, (960 - 23 * 32) / 2, "가로 중앙 정렬")
    t.expectEqual(wide.originY, (1050 - 27 * 32) / 2, "세로 중앙 정렬")
}
```

`main.swift` 의 `runOfficeFloorPlanTests(runner)` 다음 줄에 등록한다.

```swift
runOfficeViewMetricsTests(runner)
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd clients/idaeri-console && swift run ConsoleCoreTests`
Expected: 빌드 실패 — `cannot find 'officeViewMetrics' in scope`.

- [ ] **Step 3: 순수 함수를 구현한다**

`Sources/ConsoleCore/OfficeViewMetrics.swift`:

```swift
import Foundation

/// 스프라이트 한 도트 칸의 픽셀 수. 에셋 파이프라인의 `TILE_PX` 와 짝이다
/// (`clients/idaeri-console/scripts/build-sprites.py`).
///
/// 화면 배율이 이 값의 정수배가 아니면 도트가 불규칙하게 버려져 직선이 몇 칸마다 어긋난다.
/// 40px 이 아니라 32px 인 이유는 정수 배수가 확대에만 쓸 수 있기 때문이다 — 40px 에셋은
/// 실사용 창(960x1050, 격자 23x27)에서 1배면 세로가 넘치고 1/2배면 화면의 4분의 1만 쓴다.
public let officeSpriteUnit: Double = 32

/// 격자를 화면에 앉히는 값. 타일 크기와 격자 왼쪽 아래 원점.
public struct OfficeViewMetrics: Equatable, Sendable {
    public let tileSize: Double
    public let originX: Double
    public let originY: Double
    public init(tileSize: Double, originX: Double, originY: Double) {
        self.tileSize = tileSize
        self.originX = originX
        self.originY = originY
    }
}

/// 창 크기에 맞는 **정수 배율** 타일 크기와 중앙 정렬 원점을 낸다(순수).
///
/// 창에 들어가는 가장 큰 배수를 고르고, 한 배수도 못 들어가면 절반 단계(16px)까지 내려간다.
/// 그 아래로는 내려가지 않는다 — 글자 크기에 하한이 있어 더 줄이면 이름표가 읽히지 않는다.
public func officeViewMetrics(
    viewWidth: Double,
    viewHeight: Double,
    columns: Int,
    rows: Int,
    unit: Double = officeSpriteUnit
) -> OfficeViewMetrics {
    guard viewWidth > 0, viewHeight > 0, columns > 0, rows > 0, unit > 0 else {
        return OfficeViewMetrics(tileSize: unit, originX: 0, originY: 0)
    }
    let fitting = min(viewWidth / Double(columns), viewHeight / Double(rows))
    let steps = (fitting / unit).rounded(.down)
    let tileSize = steps >= 1 ? steps * unit : unit / 2
    let usedWidth = tileSize * Double(columns)
    let usedHeight = tileSize * Double(rows)
    return OfficeViewMetrics(
        tileSize: tileSize,
        originX: (viewWidth - usedWidth) / 2,
        originY: (viewHeight - usedHeight) / 2
    )
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `swift run ConsoleCoreTests`
Expected: PASS. `OfficeViewMetrics` 스위트가 초록.

- [ ] **Step 5: 씬을 이 함수로 갈아탄다**

`OfficeScene.swift` 의 `recalculateMetrics()` 본문을 바꾼다.

```swift
    private func recalculateMetrics() {
        guard plan.columns > 0, plan.rows > 0, size.width > 0, size.height > 0 else {
            return
        }
        let metrics = officeViewMetrics(
            viewWidth: Double(size.width),
            viewHeight: Double(size.height),
            columns: plan.columns,
            rows: plan.rows
        )
        tileSize = CGFloat(metrics.tileSize)
        spriteScale = tileSize / referenceTileSize
        characterScale = spriteScale * characterScaleFactor
        gridOrigin = CGPoint(x: metrics.originX, y: metrics.originY)
    }
```

그리고 `OfficeFloorPlan.swift:39` 의 기준 규격을 새 상수에 맞춘다.

```swift
public let officeReferenceTileSize: Double = officeSpriteUnit
```

- [ ] **Step 6: 규격 변경이 파생값을 깨뜨리는지 확인한다**

Run: `swift build && swift run ConsoleCoreTests`
Expected: 여기서 실패가 나오는 것이 정상이다. `officeReferenceTileSize` 는 서류 더미 반폭(`OfficeFloorPlan.swift:161`) · 앉은 캐릭터 크기(245) · 가구 높이 환산(1099) · 가구 폭 상한(1113) 에 물려 있고, 규격 의존 테스트가 `OfficeIdleTests` · `OfficeInteractionTests` · `OfficeFloorPlanTests` · `OfficeNameplateFitTests` · `PresidentBriefingTests` 다섯 파일이다.

실패한 단정을 하나씩 보고, **에셋 실측에서 온 상수(도트 수)는 그대로 두고 타일 배수로 환산되는 쪽만 고친다.** 예로 `officeDeskPaperHalfWidthTiles = 7.0 / 2.0 / officeReferenceTileSize` 의 `7.0` 은 `desk-paper.png` 의 실측 폭이라 유지하고, 나누는 규격만 32로 바뀌어 결과가 커지는 것이 맞다.

- [ ] **Step 7: 이름표 겹침 회귀를 실측한다**

전체 뷰가 38.9px → 32px 로 18% 작아진다. 글자 크기에는 하한이 있어 겹침이 이 변경의 최대 위험이다.

Run:
```bash
swift run IdaeriConsole --render /tmp/refit-labels-wide.png --hour 15 --size 960x1050 --labels
swift run IdaeriConsole --render /tmp/refit-labels-short.png --hour 15 --size 960x563 --labels
```
Expected: 두 렌더가 성공하고, 겹침으로 지목된 이름표 목록이 재정합 전보다 늘지 않는다. 늘었으면 `OfficeNameplateFitTests` 의 하한을 낮추지 말고 **전체 뷰를 16px 로 내리는 대신 방 뷰(Task 4·5)를 주 동선으로 삼는 쪽**을 택한다 — 하한을 낮추면 읽히지 않는 이름표를 통과시키게 된다.

- [ ] **Step 8: 게이트와 커밋**

```bash
swift build && swift run ConsoleCoreTests
cd ../.. && pnpm lint:check && pnpm test && pnpm build
git add clients/idaeri-console/Sources
git commit -m "fix(console): 비정수 배율로 흐려지던 화면 타일을 32px 정수 배율로 고정"
```

---

### Task 4: 방 포커스 배율·원점 판정 (순수 함수)

**Files:**
- Modify: `clients/idaeri-console/Sources/ConsoleCore/OfficeViewMetrics.swift`
- Modify: `clients/idaeri-console/Sources/ConsoleCoreTests/OfficeViewMetricsTests.swift`

**Interfaces:**
- Consumes: Task 3 의 `officeViewMetrics` · `OfficeViewMetrics` · `officeSpriteUnit`, 그리고 기존 `OfficeRect`(`OfficeRoomLayout.swift`)
- Produces: `officeFocusedViewMetrics(viewWidth:viewHeight:columns:rows:focus:margin:) -> OfficeViewMetrics` — `focus` 사각형이 화면 가운데 오도록 배율을 올리고 원점을 옮긴다. Task 5 가 이것을 씬에 배선한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`OfficeViewMetricsTests.swift` 끝에 추가한다.

```swift
    // 방 하나(10x7 칸)를 실사용 창에 담으면 32px 보다 큰 배수를 쓸 수 있다.
    // 여유 margin 2칸을 물려 14x11 칸을 담는 것이 기준이다.
    // `OfficeRect` 는 `OfficeRoomLayout.swift` 에 이미 있는 값 타입이다.
    let room = OfficeRect(x: 1, y: 6, width: 10, height: 7)
    let focused = officeFocusedViewMetrics(
        viewWidth: 960, viewHeight: 1050, columns: 23, rows: 27, focus: room
    )
    t.expectEqual(focused.tileSize, 64, "방 뷰는 64px")

    // 방 중심이 화면 중심에 온다.
    let centerX = focused.originX + (room.x + room.width / 2) * focused.tileSize
    let centerY = focused.originY + (room.y + room.height / 2) * focused.tileSize
    t.expect(abs(centerX - 480) < 0.5, "방 중심이 가로 중앙 (실제 \(centerX))")
    t.expect(abs(centerY - 525) < 0.5, "방 중심이 세로 중앙 (실제 \(centerY))")

    // 방 뷰도 정수 배율이어야 한다.
    for width in stride(from: 500.0, through: 1800.0, by: 53.0) {
        let metrics = officeFocusedViewMetrics(
            viewWidth: width, viewHeight: 900, columns: 23, rows: 27, focus: room
        )
        let steps = metrics.tileSize / officeSpriteUnit
        t.expect(
            steps == steps.rounded() && steps >= 1,
            "방 뷰 타일 \(metrics.tileSize)px 가 정수배가 아니다 (창 폭 \(width))"
        )
    }

    // 방 뷰는 전체 뷰보다 작아지지 않는다 — 눌러서 확대한 것이 축소가 되면 안 된다.
    let full = officeViewMetrics(viewWidth: 960, viewHeight: 1050, columns: 23, rows: 27)
    t.expect(focused.tileSize >= full.tileSize, "방 뷰가 전체 뷰보다 크거나 같다")
```

- [ ] **Step 2: 실패를 확인한다**

Run: `swift run ConsoleCoreTests`
Expected: 빌드 실패 — `cannot find 'officeFocusedViewMetrics' in scope`.

- [ ] **Step 3: 구현한다**

`OfficeViewMetrics.swift` 에 추가한다.

```swift
/// 방 하나를 화면 가운데에 담는 정수 배율 값(순수).
///
/// 카메라를 쓰지 않는다. 타일 크기와 원점만 바꿔 기존 재배치 경로를 그대로 태우므로,
/// 이름표 글자 크기 계산(타일 크기 기반)이 함께 따라온다 — 카메라로 확대하면 글자도 같이
/// 커져서 겹침 규칙을 다시 짜야 한다.
///
/// `margin` 은 방 주변으로 함께 보여 줄 칸 수다. 벽과 문이 방 경계에 붙어 있어, 0 으로 두면
/// 방문이 화면 끝에 걸린다.
public func officeFocusedViewMetrics(
    viewWidth: Double,
    viewHeight: Double,
    columns: Int,
    rows: Int,
    focus: OfficeRect,
    margin: Double = 2,
    unit: Double = officeSpriteUnit
) -> OfficeViewMetrics {
    guard viewWidth > 0, viewHeight > 0, focus.width > 0, focus.height > 0, unit > 0 else {
        return officeViewMetrics(
            viewWidth: viewWidth, viewHeight: viewHeight,
            columns: columns, rows: rows, unit: unit
        )
    }
    let spanWidth = focus.width + margin * 2
    let spanHeight = focus.height + margin * 2
    let fitting = min(viewWidth / spanWidth, viewHeight / spanHeight)
    let steps = (fitting / unit).rounded(.down)
    let full = officeViewMetrics(
        viewWidth: viewWidth, viewHeight: viewHeight,
        columns: columns, rows: rows, unit: unit
    )
    let tileSize = max(steps >= 1 ? steps * unit : unit, full.tileSize)
    let focusCenterX = (focus.x + focus.width / 2) * tileSize
    let focusCenterY = (focus.y + focus.height / 2) * tileSize
    return OfficeViewMetrics(
        tileSize: tileSize,
        originX: viewWidth / 2 - focusCenterX,
        originY: viewHeight / 2 - focusCenterY
    )
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `swift run ConsoleCoreTests`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add clients/idaeri-console/Sources
git commit -m "feat(console): 방 하나를 화면 가운데에 담는 정수 배율 판정 추가"
```

---

### Task 5: 방 뷰 배선 — 클릭 · esc · 방 이름 머리글

**Files:**
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/OfficeScene.swift` (`recalculateMetrics` · `mouseDown` 3077 부근 · 포커스 상태 프로퍼티)
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/OfficeView.swift` (머리글 · `esc` 키 · 콜백)
- Modify: `clients/idaeri-console/Sources/ConsoleCore/OfficeInteraction.swift` (누른 지점이 어느 방인지 판정하는 순수 함수)
- Modify: `clients/idaeri-console/Sources/ConsoleCoreTests/OfficeInteractionTests.swift`

**Interfaces:**
- Consumes: Task 4 의 `officeFocusedViewMetrics`, 기존 `agentTypeAt`(`OfficeInteraction.swift:12`) · `departmentRoomLayout`(`OfficeRoomLayout.swift:44`)
- Produces: `officeRoomAt(point:rooms:tileSize:origin:) -> Department?` · 씬의 `focusedDepartment: Department?` · `OfficeView` 의 방 머리글

- [ ] **Step 1: 누른 지점이 어느 방인지 판정하는 테스트를 쓴다**

`OfficeInteractionTests.swift` 의 스위트 함수 안에 추가한다.

```swift
    // 방 판정 — 화면 좌표를 격자로 되돌려 어느 구역에 들어가는지 본다.
    // 씬이 들고 있는 것은 `plan.zones: [DepartmentZone]` 이므로 그 타입을 그대로 받는다
    // (`OfficeFloorPlan.swift:1347` — department · origin: TilePoint · width · height).
    let zones = [
        DepartmentZone(
            department: .planning, origin: TilePoint(x: 1, y: 6), width: 10, height: 7
        ),
        DepartmentZone(
            department: .engineering, origin: TilePoint(x: 13, y: 6), width: 10, height: 7
        ),
    ]
    // 기획 방 안쪽(격자 3, 8) → 화면 (3.5*32, 8*32) = (112, 256)
    t.expectEqual(
        officeZoneAt(x: 112, y: 256, zones: zones, tileSize: 32, originX: 0, originY: 0),
        .planning,
        "기획 방 안쪽을 누르면 기획"
    )
    // 개발 방 안쪽(격자 15, 8)
    t.expectEqual(
        officeZoneAt(x: 496, y: 256, zones: zones, tileSize: 32, originX: 0, originY: 0),
        .engineering,
        "개발 방 안쪽을 누르면 개발"
    )
    // 복도(격자 12, 8) — 두 방 사이. 방이 아니다.
    t.expectNil(
        officeZoneAt(x: 400, y: 256, zones: zones, tileSize: 32, originX: 0, originY: 0),
        "복도는 방이 아니다"
    )
    // 원점이 밀린 경우에도 같은 판정이 나온다.
    t.expectEqual(
        officeZoneAt(x: 212, y: 356, zones: zones, tileSize: 32, originX: 100, originY: 100),
        .planning,
        "원점 이동을 반영한다"
    )
```

- [ ] **Step 2: 실패를 확인한다**

Run: `swift run ConsoleCoreTests`
Expected: 빌드 실패 — `cannot find 'officeZoneAt' in scope`.

- [ ] **Step 3: 판정 함수를 구현한다**

`OfficeInteraction.swift` 에 추가한다.

```swift
/// 화면 좌표가 어느 부서 구역 안인지(순수). 구역 밖이면 `nil`.
///
/// 좌표를 격자로 되돌려 구역 사각형에 넣어 본다. 좌석·가구는 보지 않는다 — 좌석을 누른 경우는
/// 호출부가 `agentTypeAt` 으로 먼저 걸러내고, 여기까지 오면 바닥을 누른 것이다.
public func officeZoneAt(
    x: Double,
    y: Double,
    zones: [DepartmentZone],
    tileSize: Double,
    originX: Double,
    originY: Double
) -> Department? {
    guard tileSize > 0 else {
        return nil
    }
    let tileX = (x - originX) / tileSize
    let tileY = (y - originY) / tileSize
    return zones.first { zone in
        tileX >= Double(zone.origin.x) && tileX < Double(zone.origin.x + zone.width)
            && tileY >= Double(zone.origin.y) && tileY < Double(zone.origin.y + zone.height)
    }?.department
}

/// 구역을 배율 판정이 쓰는 사각형으로 옮긴다(순수).
public func officeZoneRect(_ zone: DepartmentZone) -> OfficeRect {
    OfficeRect(
        x: Double(zone.origin.x), y: Double(zone.origin.y),
        width: Double(zone.width), height: Double(zone.height)
    )
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `swift run ConsoleCoreTests`
Expected: PASS.

- [ ] **Step 5: 씬에 포커스 상태를 넣는다**

`OfficeScene` 에 프로퍼티와 전환 함수를 추가하고, `recalculateMetrics()` 가 포커스를 반영하게 한다.

```swift
    /// 지금 확대해 보고 있는 방. `nil` 이면 전체 뷰.
    private(set) var focusedDepartment: Department?

    /// 방 뷰로 들어가거나(전달값 있음) 전체로 돌아간다(`nil`).
    /// 배율 사이를 보간하지 않는다 — 중간 프레임이 전부 비정수 배율이 된다.
    func setFocus(_ department: Department?) {
        guard focusedDepartment != department else {
            return
        }
        focusedDepartment = department
        // 기존 재렌더 경로를 그대로 태운다. `sync` 가 `recalculateMetrics()` 를 부르고,
        // 타일 크기가 바뀌었으므로 `geometryChanged` 가 참이 되어 바닥·가구·책상·대표가
        // 다시 그려진다(`OfficeScene.swift:337-345`). 마지막 스냅샷은 `sync` 가 이미
        // `lastSyncedAgents` · `lastSyncedApprovals` 로 보관해 둔다(311-316).
        //
        // `rebuildPlan: false` — 평면도는 명단·부서 구성으로만 정해진다. 포커스는 좌표계만 바꾼다.
        // `consumesAttendanceBoundary: false` — 포커스 전환이 출퇴근 연출을 소비하면 안 된다.
        sync(
            agents: lastSyncedAgents, approvals: lastSyncedApprovals,
            rebuildPlan: false, consumesAttendanceBoundary: false
        )
    }
```

`recalculateMetrics()` 를 포커스 분기로 바꾼다.

```swift
    private func recalculateMetrics() {
        guard plan.columns > 0, plan.rows > 0, size.width > 0, size.height > 0 else {
            return
        }
        let focusRect = focusedDepartment.flatMap { department in
            plan.zones.first { $0.department == department }.map(officeZoneRect)
        }
        let metrics: OfficeViewMetrics
        if let focusRect {
            metrics = officeFocusedViewMetrics(
                viewWidth: Double(size.width),
                viewHeight: Double(size.height),
                columns: plan.columns,
                rows: plan.rows,
                focus: focusRect
            )
        } else {
            metrics = officeViewMetrics(
                viewWidth: Double(size.width),
                viewHeight: Double(size.height),
                columns: plan.columns,
                rows: plan.rows
            )
        }
        tileSize = CGFloat(metrics.tileSize)
        spriteScale = tileSize / referenceTileSize
        characterScale = spriteScale * characterScaleFactor
        gridOrigin = CGPoint(x: metrics.originX, y: metrics.originY)
    }
```

- [ ] **Step 6: 클릭을 배선한다**

`mouseDown(with:)`(`OfficeScene.swift:3077`) 에서 대표·좌석 판정이 끝난 뒤(기존 동작을 먼저 태운 뒤)에 구역 판정을 넣는다.

```swift
        // 대표·좌석을 누른 경우는 위에서 이미 처리했다. 여기까지 오면 바닥이나 여백이다.
        let pressedZone = officeZoneAt(
            x: Double(location.x), y: Double(location.y),
            zones: plan.zones, tileSize: Double(tileSize),
            originX: Double(gridOrigin.x), originY: Double(gridOrigin.y)
        )
        if focusedDepartment == nil {
            if let pressedZone {
                setFocus(pressedZone)
            }
        } else if pressedZone != focusedDepartment {
            // 방 뷰에서 그 방 밖을 누르면 전체로 돌아간다.
            setFocus(nil)
        }
```

- [ ] **Step 7: 머리글과 esc 를 붙인다**

`OfficeView.swift` 에 방 이름 머리글을 얹는다. 씬 노드가 아니라 기존 요약 바와 같은 층에 두어 타일 크기 변화에 영향받지 않게 한다.

```swift
    /// 방 뷰에서 지금 어느 방인지와 나가는 방법. 확대하면 방 이름표가 화면 밖으로 밀릴 수 있어
    /// 씬 밖에 따로 둔다.
    @ViewBuilder
    private var roomHeader: some View {
        if let department = focusedDepartment {
            HStack(spacing: 8) {
                Text(department.label).font(Typography.sectionTitle)
                Text("esc · 바깥 클릭으로 전체 보기").foregroundStyle(.secondary)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(.black.opacity(0.55), in: Capsule())
        }
    }
```

부서 표시 이름은 `Department.label`(`Sources/ConsoleCore/Department.swift:33`) 이다. 방 이름표가 이미 이 값을 쓴다.

`esc` 는 뷰에 키 처리를 붙인다.

```swift
        .onExitCommand { scene.setFocus(nil) }
```

- [ ] **Step 8: 방 6개를 렌더로 확인한다**

방마다 격자 위치가 달라 한 방만 맞을 수 있다. Task 6 의 `--room` 옵션이 없으면 앱을 띄워 눌러 확인하고, Task 6 을 먼저 해도 된다.

Run: `swift build && swift run IdaeriConsole`
Expected: 방 6개를 각각 눌러 확대되고, 확대 상태에서 이름·말풍선이 읽히며, `esc` 와 바깥 클릭으로 전체로 돌아온다. 대표를 누르면 여전히 지시 바가 열린다.

- [ ] **Step 9: 게이트와 커밋**

```bash
swift build && swift run ConsoleCoreTests
cd ../.. && pnpm lint:check && pnpm test && pnpm build
git add clients/idaeri-console/Sources
git commit -m "feat(console): 방을 눌러 크게 보는 2단 뷰 — 클릭·esc·방 머리글"
```

---

### Task 6: 오프스크린 렌더에 `--room` 옵션

방 뷰를 앱을 띄우지 않고 검증할 수 있게 한다. 이것이 없으면 방 6개 확인이 매번 사람 몫이 된다.

**Files:**
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/main.swift` (인자 파싱 · `renderOfficeScene` 호출)
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/OfficeSceneRender.swift` (`renderOfficeScene` 시그니처)
- Modify: `clients/idaeri-console/Sources/ConsoleCore/OfficeViewMetrics.swift` (부서 문자열 파싱)
- Modify: `clients/idaeri-console/Sources/ConsoleCoreTests/OfficeViewMetricsTests.swift`

**Interfaces:**
- Consumes: Task 5 의 `OfficeScene.setFocus(_:)`
- Produces: `officeParseDepartment(_ raw: String) -> Department?` · CLI 인자 `--room <부서키>`

- [ ] **Step 1: 부서 문자열 파싱 테스트를 쓴다**

```swift
    // CLI 인자로 방을 지정한다. 대소문자와 하이픈·밑줄 차이를 흡수한다.
    t.expectEqual(officeParseDepartment("engineering"), .engineering, "영문 키")
    t.expectEqual(officeParseDepartment("ENGINEERING"), .engineering, "대문자")
    t.expectEqual(officeParseDepartment("internal-ops"), .internalOps, "하이픈")
    t.expectEqual(officeParseDepartment("internal_ops"), .internalOps, "밑줄")
    t.expectNil(officeParseDepartment("없는부서"), "모르는 값은 nil")
```

- [ ] **Step 2: 실패를 확인한다**

Run: `swift run ConsoleCoreTests`
Expected: 빌드 실패 — `cannot find 'officeParseDepartment' in scope`.

- [ ] **Step 3: 파싱 함수를 구현한다**

`OfficeViewMetrics.swift` 에 추가한다. `Department` 의 실제 케이스 이름은 `OfficeRoomLayout.swift` 의 `departmentOrder` 에 있는 여섯 개(`planning` · `engineering` · `review` · `executive` · `growth` · `internalOps`)다.

```swift
/// `--room` 인자 문자열을 부서로 바꾼다(순수). 모르는 값은 `nil`.
public func officeParseDepartment(_ raw: String) -> Department? {
    let key = raw.lowercased().replacingOccurrences(of: "-", with: "")
        .replacingOccurrences(of: "_", with: "")
    switch key {
    case "planning": return .planning
    case "engineering": return .engineering
    case "review": return .review
    case "executive": return .executive
    case "growth": return .growth
    case "internalops": return .internalOps
    default: return nil
    }
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `swift run ConsoleCoreTests`
Expected: PASS.

- [ ] **Step 5: CLI 에 인자를 붙인다**

`main.swift` 의 `--hour` 파싱 옆에 넣고, `renderOfficeScene` 에 넘긴다.

```swift
    let roomIndex = CommandLine.arguments.firstIndex(of: "--room")
    let room = roomIndex.flatMap { index -> Department? in
        guard index + 1 < CommandLine.arguments.count else {
            return nil
        }
        return officeParseDepartment(CommandLine.arguments[index + 1])
    }
```

`renderOfficeScene` 에 `room: Department?` 매개변수를 더하고, 씬을 만든 뒤 스냅샷을 넣기 전에 `scene.setFocus(room)` 을 부른다. 사용법 주석도 함께 남긴다.

```swift
//   swift run IdaeriConsole --render /tmp/office.png --room engineering
```

- [ ] **Step 6: 방 6개를 렌더로 확인한다**

Run:
```bash
for r in planning engineering review executive growth internal-ops; do
  swift run IdaeriConsole --render "/tmp/refit-room-$r.png" --hour 15 --size 960x1050 --room "$r" || echo "실패 $r"
done
python3 clients/idaeri-console/scripts/measure-palette.py /tmp/refit-room-engineering.png
```
Expected: 여섯 장이 모두 생성되고, 각 방이 화면 가운데에 확대되어 있다. 방 이름과 좌석이 잘리지 않는다.

- [ ] **Step 7: 게이트와 커밋**

```bash
swift build && swift run ConsoleCoreTests
git add clients/idaeri-console/Sources
git commit -m "feat(console): 방 뷰를 앱 없이 검증하는 --room 렌더 옵션"
```

---

### Task 7: 무료 픽셀아트 팩 도입 (사용자 개입 필요)

앞의 여섯 태스크로 규격과 팔레트는 정합되지만, 원본이 여전히 생성 AI 일러스트다. 이 태스크가 원본 품질을 올린다. **itch.io 다운로드는 로그인·수동 동의가 필요할 수 있어 사용자가 직접 받아야 한다.**

**Files:**
- Create: `clients/idaeri-console/Sources/IdaeriConsole/Resources/raw/pack-<선정팩>/` (받은 시트)
- Create: `clients/idaeri-console/Resources-LICENSE.md` (라이선스 전문 · 출처 URL)
- Modify: `clients/idaeri-console/scripts/build-sprites.py` (`SHEETS` 매핑)
- Modify: `clients/idaeri-console/scripts/ASSET-SHEET-SPEC.md`

**Interfaces:**
- Consumes: Task 2 의 `TILE_PX` · `PALETTE_MAX` · `snap_to_grid` · `quantize_sprite`
- Produces: 교체된 `Resources/sprites/*.png` (이름은 기존과 동일 — 코드 참조를 바꾸지 않는다)

- [ ] **Step 1: 후보 세 팩을 받아 비교한다**

사용자에게 아래를 요청한다. 자동 다운로드가 막히면 대신 받아 달라고 부탁한다.

- LimeZu *Modern Interiors* 무료판 — https://limezu.itch.io/moderninteriors (16×16, 애니메이션 캐릭터 4명 포함, 무료판은 개인 프로젝트 전용)
- Donarg *Office Interior Tileset* — https://donarg.itch.io/officetileset (16/32/48 세 규격, 오피스 전용)
- Antea *Free Furniture Office Equipment Set* — https://stcrbcn.itch.io/furniture-office-set (40여 종, CC-BY 계열)

받은 팩마다 `scripts/measure-palette.py` 로 색 수를 재고, 아래 기준으로 고른다. 판정 결과를 이 태스크 아래에 표로 남긴다.

1. **오피스 가구 범위** — 책상 · 의자 · 모니터 · 책장 · 화분 · 정수기 · 냉장고 · 커피머신 · 캐비닛 · 화이트보드 · 소파 · 러그 · 문 · 벽 중 몇 개가 나오는가
2. **색 수** — 파일당 64색 이하인가 (진짜 픽셀아트면 자연히 통과한다)
3. **규격** — 16 또는 32 의 정수 규격인가
4. **캐릭터** — 4방향 걷기와 앉은 자세가 있는가

- [ ] **Step 2: 화면에 실제로 나오는 스프라이트만 교체 대상으로 좁힌다**

에셋 22종(문 · 러그 · 벽 장식 등)은 파일만 있고 배선이 없다. 안 쓰는 것을 옮기느라 작업량을 늘리지 않는다.

Run:
```bash
cd clients/idaeri-console
for f in Sources/IdaeriConsole/Resources/sprites/*.png; do
  n=$(basename "$f" .png)
  grep -rqF "\"$n\"" Sources/ || echo "미배선 $n"
done
```
Expected: 배선되지 않은 스프라이트 목록이 나온다. 교체 대상은 이 목록에 **없는** 것들이다.

- [ ] **Step 3: 라이선스를 저장소에 남긴다**

`Resources-LICENSE.md` 에 선정 팩의 이름 · 제작자 · 출처 URL · 라이선스 전문 · 받은 날짜를 적는다. LimeZu 무료판을 골랐다면 **"개인 프로젝트 전용, 배포 시 $1.50 유료판 필요"** 를 명시한다.

- [ ] **Step 4: `SHEETS` 매핑을 갱신하고 다시 굽는다**

새 시트의 셀 배치에 맞춰 `SHEETS` 를 고친다. 셀 검출은 배경이 순수 마젠타 `#FF00FF` 단색일 때 동작하므로, 팩이 투명 배경이면 `detect_cells` 대신 **격자 좌표로 자르는 경로**를 추가한다(정품 팩은 규격 격자라 좌표 계산이 가능하다 — 생성 AI 시트와 달리 bounding box 검출이 필요 없다).

Run: `python3 scripts/build-sprites.py && python3 scripts/measure-palette.py Sources/IdaeriConsole/Resources/sprites`
Expected: 종료 코드 0, 최다 색 64 이하, 타일 32×32.

- [ ] **Step 5: 캐릭터 리컬러를 확인한다**

새 캐릭터를 쓰기로 했다면 색 규약을 다시 맞춘다 — 몸에 흰색 · 검정 · 회색 외의 무채색을 쓰면 셔츠 · 바지로 오인되고, 앉은 자세 의자는 채도 있는 색이어야 바지색 판정에서 보호된다. **캐릭터 시트를 늘리면 `build-sprites.py` 의 `SHEETS` · `AgentRole.swift` 의 `characterSheetPrefixes` · `OfficeChoreographyTests.swift` 의 걸음 프레임 개수 세 곳을 함께 고쳐야 한다** — 앞의 둘 중 하나만 고치면 스프라이트는 생기는데 아무도 배정받지 않아 조용히 실패한다.

캐릭터 확보에 실패하면 **가구 · 바닥 · 벽만 교체하고 캐릭터는 기존 것을 유지한다.** 그 경우 화면 색 수 목표를 다시 잡고 기준선 문서에 사유를 적는다.

- [ ] **Step 6: 전체 회귀를 렌더로 확인한다**

Run:
```bash
swift build
swift run IdaeriConsole --render /tmp/refit-final-day.png --hour 15 --size 960x1050
swift run IdaeriConsole --render /tmp/refit-final-night.png --hour 23 --size 960x1050
swift run IdaeriConsole --render /tmp/refit-final-labels.png --hour 15 --size 960x563 --labels
swift run IdaeriConsole --render /tmp/refit-final-room.png --hour 15 --size 960x1050 --room engineering
python3 clients/idaeri-console/scripts/measure-palette.py /tmp/refit-final-day.png
```
Expected: 화면 고유색이 **500 이하**(기준선 15,614). 밤 렌더에 창 채광 · 벽램프 · 책상 조명이 살아 있고, 이름표 겹침이 늘지 않았고, 방 뷰가 정상이다.

- [ ] **Step 7: 게이트와 커밋**

```bash
swift build && swift run ConsoleCoreTests
cd ../.. && pnpm lint:check && pnpm test && pnpm build
git add clients/idaeri-console/Sources clients/idaeri-console/scripts
git add -f clients/idaeri-console/Resources-LICENSE.md clients/idaeri-console/scripts/ASSET-SHEET-SPEC.md
git commit -m "feat(console): 생성 AI 시트를 정품 픽셀아트 팩으로 교체"
```

---

## 남는 것 (이 계획 밖)

- **웹 렌더러 반영** — `clients/office-web/sprites` 에 같은 102개가 복사되어 있다. 맥에서 확정한 뒤 옮기는 선례를 따라 별도 회차로 한다.
- **화면을 안 열게 되는 문제** — 가동률 5.5% · 정보 중복은 사용성 축이라 별도로 다룬다.
- **방 안 좌석 재배치 · 시점 변경 · 부드러운 확대 연출** — 스펙 §4 참조.
