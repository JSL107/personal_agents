#!/usr/bin/env python3
"""raw 시트(생성 AI 산출물) → 게임용 개별 스프라이트 PNG.

세 가지를 한다:
  1. 셀 분리 — 마젠타 배경 위에 흩어진 오브젝트를 연결 성분으로 찾아 자른다.
  2. 정수배 축소 — 원본은 1 도트가 약 8 화면픽셀이라 8배로 줄여 1 도트 = 1 픽셀로 만든다.
     정수배가 아니면 도트 폭이 들쭉날쭉해져 픽셀아트 질감이 깨진다.
  3. 배경 제거 — 마젠타(#FF00FF 계열)를 투명으로. 사무실에 없는 색이라 오브젝트를 안 갉는다.

에셋을 다시 뽑았을 때만 실행하면 된다. 산출물(sprites/)은 커밋되므로 앱 빌드에는 불필요.

    python3 scripts/build-sprites.py

의존성: Pillow (pip install pillow)
"""

from __future__ import annotations

import sys
from collections import deque
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow 가 필요하다: pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "Sources/IdaeriConsole/Resources/raw"
OUT = ROOT / "Sources/IdaeriConsole/Resources/sprites"

# 원본 1 도트 = 8 화면픽셀 (dotsize 실측). 정수배 축소라야 도트가 균일하게 남는다.
SCALE = 8

# 셀 순서 → 파일명. 검출은 위→아래·왼→오른쪽 읽기 순서로 정렬된다.
# 캐릭터 좌/우는 미러 불일치가 3.7% 라 한 장만 쓰고 코드에서 뒤집는다(4번 셀은 버린다).
SHEETS: dict[str, list[str | None]] = {
    "character-base": ["char-down", "char-up", "char-side", None, "char-sit"],
    # 추가 캐릭터 시트(선택) — 없으면 건너뛴다. 있으면 사람마다 다른 시트가 배정돼
    # 얼굴·체형까지 갈린다. 규격은 base 와 동일(5포즈 한 줄, 마젠타 배경).
    "character-b": ["charb-down", "charb-up", "charb-side", None, "charb-sit"],
    "character-c": ["charc-down", "charc-up", "charc-side", None, "charc-sit"],
    "character-d": ["chard-down", "chard-up", "chard-side", None, "chard-sit"],
    "tiles-floor": [
        "tile-wood-a",
        "tile-wood-b",
        "tile-carpet-light",
        "tile-carpet-dark",
        "tile-ceramic",
        "tile-wall",
    ],
    "furniture": [
        "furn-desk",
        "furn-chair-down",
        "furn-chair-up",
        "furn-meeting-table",
        "furn-sofa-2",
        "furn-sofa-3",
        "furn-coffee-table",
        "furn-coffee-machine",
        "furn-water-cooler",
        "furn-whiteboard",
        "furn-printer",
        "furn-plant-tall",
        "furn-bookshelf",
        "furn-plant-small",
        "furn-clock",
        "furn-trash",
    ],
}


def is_background(pixel: tuple[int, int, int]) -> bool:
    """마젠타 계열인가.

    g 를 90 미만으로 조여야 보라색 소파(g≈80~100, r≈150)를 배경으로 오인하지 않는다.
    r/b 를 200 이상으로 두는 것도 같은 이유 — 소파는 r 이 200 에 못 미친다.
    """
    red, green, blue = pixel
    return red > 200 and blue > 200 and green < 90


def detect_cells(image: Image.Image) -> list[tuple[int, int, int, int]]:
    """마젠타로 둘러싸인 오브젝트 덩어리들의 bounding box 를 읽기 순서로 반환한다."""
    width, height = image.size
    pixels = image.load()
    # 원본 해상도로 BFS 하면 느리다 — 4px 격자로 훑어도 셀 분리에는 충분하다.
    step = 4
    grid_w, grid_h = width // step, height // step
    solid = [
        [not is_background(pixels[x * step, y * step]) for x in range(grid_w)]
        for y in range(grid_h)
    ]
    visited = [[False] * grid_w for _ in range(grid_h)]
    boxes: list[tuple[int, int, int, int]] = []

    for start_y in range(grid_h):
        for start_x in range(grid_w):
            if not solid[start_y][start_x] or visited[start_y][start_x]:
                continue
            queue = deque([(start_x, start_y)])
            visited[start_y][start_x] = True
            min_x = max_x = start_x
            min_y = max_y = start_y
            size = 0
            while queue:
                current_x, current_y = queue.popleft()
                size += 1
                min_x, max_x = min(min_x, current_x), max(max_x, current_x)
                min_y, max_y = min(min_y, current_y), max(max_y, current_y)
                for offset_x, offset_y in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    next_x, next_y = current_x + offset_x, current_y + offset_y
                    if (
                        0 <= next_x < grid_w
                        and 0 <= next_y < grid_h
                        and solid[next_y][next_x]
                        and not visited[next_y][next_x]
                    ):
                        visited[next_y][next_x] = True
                        queue.append((next_x, next_y))
            if size < 20:  # 압축 노이즈로 생긴 점 덩어리
                continue
            boxes.append(
                (
                    min_x * step,
                    min_y * step,
                    (max_x + 1) * step - 1,
                    (max_y + 1) * step - 1,
                )
            )

    # 읽기 순서 — y 를 셀 높이 기준으로 묶어 같은 줄로 보고, 줄 안에서 x 순.
    average_height = sum(box[3] - box[1] for box in boxes) / max(len(boxes), 1)
    band = max(average_height * 0.6, 1)
    boxes.sort(key=lambda box: (round(box[1] / band), box[0]))
    return boxes


def shrink(cell: Image.Image) -> Image.Image:
    """정수배 nearest 축소. 각 도트 블록의 중앙을 뽑아 경계 번짐을 피한다."""
    width, height = cell.size
    # 블록 중앙에서 샘플링하도록 절반만큼 밀어 자른다.
    offset = SCALE // 2
    shifted = cell.crop((offset, offset, width, height))
    target = (max(shifted.width // SCALE, 1), max(shifted.height // SCALE, 1))
    return shifted.resize(target, Image.NEAREST)


# 마젠타 성향 = r 과 b 가 g 보다 얼마나 높은가. 실측:
#   보라 소파(살려야 함)   75~90
#   외곽 잔여(지워야 함)  99~130
# 95 를 경계로 두면 둘이 갈린다. 마진이 크지 않아 잔여 제거는 "이미 투명한 픽셀과
# 맞닿은 것" 으로만 한정한다 — 오브젝트 내부의 보라는 어차피 투명과 안 닿는다.
MAGENTA_BIAS_CUTOFF = 95


def magenta_bias(pixel: tuple[int, int, int]) -> int:
    red, green, blue = pixel
    return min(red, blue) - green


def strip_background(cell: Image.Image) -> Image.Image:
    """마젠타 픽셀을 투명으로 바꾼다."""
    rgba = cell.convert("RGBA")
    pixels = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            red, green, blue, _ = pixels[x, y]
            if is_background((red, green, blue)):
                pixels[x, y] = (0, 0, 0, 0)
    return rgba


def erode_fringe(image: Image.Image, passes: int = 3) -> Image.Image:
    """배경과 맞닿은 안티에일리어싱 잔여(분홍 테두리)를 벗겨낸다.

    생성 이미지의 경계는 오브젝트 색과 마젠타가 섞인 중간색이라 배경 판정을 통과하지
    못하고 1px 테두리로 남는다. 투명과 인접한 픽셀만 후보로 두므로 내부는 안 건드린다.
    """
    pixels = image.load()
    width, height = image.size
    for _ in range(passes):
        doomed = []
        for y in range(height):
            for x in range(width):
                if pixels[x, y][3] == 0:
                    continue
                touches_hole = any(
                    not (0 <= x + dx < width and 0 <= y + dy < height)
                    or pixels[x + dx, y + dy][3] == 0
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                )
                if not touches_hole:
                    continue
                red, green, blue, _ = pixels[x, y]
                if magenta_bias((red, green, blue)) > MAGENTA_BIAS_CUTOFF:
                    doomed.append((x, y))
        if not doomed:
            break
        for x, y in doomed:
            pixels[x, y] = (0, 0, 0, 0)
    return image


def trim(image: Image.Image) -> Image.Image:
    """투명해진 가장자리를 잘라낸다 — 타일이 반복될 때 빈 줄이 이음선으로 보이지 않게."""
    box = image.getbbox()
    return image.crop(box) if box else image


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for sheet_name, names in SHEETS.items():
        source = RAW / f"{sheet_name}.png"
        if not source.exists():
            print(f"건너뜀 — {source} 없음")
            continue
        image = Image.open(source).convert("RGB")
        boxes = detect_cells(image)
        if len(boxes) != len(names):
            print(
                f"⚠️ {sheet_name}: 셀 {len(boxes)}개 검출, 이름 {len(names)}개 — "
                "시트를 다시 뽑았다면 SHEETS 매핑을 갱신할 것"
            )
            return 1
        sheet_width, sheet_height = image.size
        for name, (x0, y0, x1, y1) in zip(names, boxes):
            if name is None:
                continue
            # 배경 여백을 물려서 자른다 — 잔여 제거가 오브젝트 경계가 아니라 배경에서 시작하도록.
            # 시트 밖으로 나가면 PIL 이 검정으로 채워 배경 판정을 빠져나가므로 범위를 가둔다.
            pad = SCALE * 2
            cell = image.crop(
                (
                    max(x0 - pad, 0),
                    max(y0 - pad, 0),
                    min(x1 + 1 + pad, sheet_width),
                    min(y1 + 1 + pad, sheet_height),
                )
            )
            sprite = trim(erode_fringe(strip_background(shrink(cell))))
            if name.startswith("tile-"):
                # 타일은 가장자리 1px 을 버린다. 잔여 제거가 못 걷어낸 경계 한 줄이 남으면
                # 반복해 깔았을 때 줄무늬로 보인다 — 패턴 타일이라 1px 손실은 티가 안 난다.
                sprite = sprite.crop(
                    (1, 1, max(sprite.width - 1, 2), max(sprite.height - 1, 2))
                )
            sprite.save(OUT / f"{name}.png")
            print(f"  {name}.png  {sprite.width}x{sprite.height}")
            total += 1
    print(f"\n{total}개 스프라이트 → {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
