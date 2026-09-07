#!/usr/bin/env python3
"""바닥 타일을 코드로 생성한다.

타일은 40x40 반복 패턴이라 도트를 하나하나 찍을 필요가 없다 — 밑색 · 이음매 · 무늬를
규칙으로 적으면 되고, 그래야 여섯 부서의 색을 **한 축(밝기)에서 나란히** 잡을 수 있다.

기존 부서 바닥은 평균 밝기가 240 · 160 · 112 · 111 · 104 · 104 로 흩어져 있었다. 복도(흰색)만
밝고 방 넷이 어두워 화면 전체가 가라앉았다. 밝기를 200~235 로 모으고 색조로만 갈라, 방이
구별되는 1차 신호(`departmentFloor` 주석)는 유지하면서 사무실을 밝게 만든다.

    python3 scripts/draw-tiles.py

의존성: Pillow (pip install pillow)
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow 가 필요하다: pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "Sources/IdaeriConsole/Resources/sprites"

# 타일 한 칸의 픽셀 수. Swift 쪽 짝은 `OfficeViewMetrics.swift` 의 `officeSpriteUnit` 이다.
#
# **20px 인 이유는 화면 배율의 계단을 촘촘하게 하기 위해서다.** 40px 이면 정수 배율이 40 · 80
# 뿐이라 중간이 없어, 창이 1840x2000 에 못 미치면 곧바로 40px 로 떨어진다(실사용 창 1900x1900
# 에서 세로가 100px 부족해 화면 절반이 빈 채로 남았다). 20px 로 내리면 20 · 40 · 60 · 80 이 되어
# 같은 창에서 60px 을 쓴다.
#
# 바닥은 여기서 굽는 절차형 타일이라 어느 배수에서도 이음매가 맞는다. 가구·캐릭터는 여전히
# 40px 기준(`officeReferenceTileSize`)으로 환산되며, 그쪽은 실물 크기 환산이라 원래부터 비정수다.
TILE_PX = 20


def flat_floor(
    base: tuple[int, int, int],
    seam: tuple[int, int, int],
    cells: int = 1,
    speckle: tuple[int, int, int] | None = None,
) -> Image.Image:
    """밑색 + 이음매 격자 + (선택) 잔점으로 바닥 한 칸을 만든다.

    `cells` 는 타일 한 칸 안에 들어가는 작은 타일 수다. 20px 타일에서는 1 이 기본이고, 그러면
    이음매가 타일 경계에만 그려져 화면에서 한 칸이 하나의 바닥 타일로 읽힌다. 잔점은 카펫
    질감용이며 **격자 위에는 찍지 않는다** — 이음매를 덮으면 격자가 끊겨 보인다.
    """
    image = Image.new("RGBA", (TILE_PX, TILE_PX), (*base, 255))
    pixels = image.load()
    step = TILE_PX // cells
    for index in range(TILE_PX):
        for edge in range(0, TILE_PX, step):
            pixels[index, edge] = (*seam, 255)
            pixels[edge, index] = (*seam, 255)
    if speckle is not None:
        # 결정론적 잔점 — 난수를 쓰면 다시 구울 때마다 무늬가 바뀌어 렌더 비교가 무의미해진다.
        for y in range(TILE_PX):
            for x in range(TILE_PX):
                if x % step == 0 or y % step == 0:
                    continue
                if (x * 7 + y * 13) % 23 == 0:
                    pixels[x, y] = (*speckle, 255)
    return image


def plank_floor(
    base: tuple[int, int, int],
    grain: tuple[int, int, int],
    seam: tuple[int, int, int],
) -> Image.Image:
    """밝은 나무 바닥 — 세로 널 + 가로 이음매."""
    image = Image.new("RGBA", (TILE_PX, TILE_PX), (*base, 255))
    pixels = image.load()
    for y in range(TILE_PX):
        for x in range(TILE_PX):
            if x % 10 == 0:
                pixels[x, y] = (*seam, 255)
            elif (x + y * 3) % 17 == 0:
                pixels[x, y] = (*grain, 255)
    for x in range(TILE_PX):
        pixels[x, 0] = (*seam, 255)
        pixels[x, TILE_PX // 2] = (*seam, 255)
    return image


# 밝기를 200~235 로 모으고 색조로만 가른다. 괄호 안은 평균 밝기.
TILES: dict[str, Image.Image] = {
    # 복도·성장 — 가장 밝은 회백색 (약 235)
    "tile-ceramic": flat_floor((240, 239, 237), (222, 221, 218)),
    # 기획 — 살짝 차가운 회색 (약 224)
    "tile-carpet-light": flat_floor(
        (228, 229, 231), (208, 210, 214), speckle=(219, 221, 224)
    ),
    # 개발·내부 — 차가운 청회색, 카펫 질감 (약 212)
    "tile-carpet-dark": flat_floor(
        (221, 225, 230), (203, 208, 215), speckle=(212, 217, 224)
    ),
    # 리뷰 — 아주 연한 나무. 채도를 낮춰 회색 계열과 나란히 서게 한다 (약 222)
    "tile-wood-a": plank_floor((236, 228, 216), (223, 212, 196), (216, 204, 186)),
    # 경영 — 같은 나무를 한 단 낮춘 것 (약 214)
    "tile-wood-b": plank_floor((231, 221, 206), (217, 204, 186), (209, 194, 173)),
    # 벽 — 흰색에 가깝게 두어 바닥과 갈린다 (약 243)
    "tile-wall": flat_floor((246, 246, 245), (232, 232, 230), cells=1),
}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, image in TILES.items():
        assert image.size == (TILE_PX, TILE_PX), f"{name}: {image.size}"
        image.save(OUT / f"{name}.png")
        pixels = list(image.convert("RGB").getdata())
        brightness = sum(sum(p) / 3 for p in pixels) / len(pixels)
        colors = len({p for p in pixels})
        print(f"  {name}.png  {TILE_PX}x{TILE_PX}  밝기 {brightness:5.1f}  {colors}색")
    print(f"\n{len(TILES)}개 바닥 타일 → {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
