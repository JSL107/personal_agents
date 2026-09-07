#!/usr/bin/env python3
"""raw 시트(생성 AI 산출물) → 게임용 개별 스프라이트 PNG.

네 가지를 한다:
  1. 셀 분리 — 마젠타 배경 위에 흩어진 오브젝트를 연결 성분으로 찾아 자른다.
  2. 정수배 축소 — 원본은 1 도트가 약 8 화면픽셀이라 8배로 줄여 1 도트 = 1 픽셀로 만든다.
     정수배가 아니면 도트 폭이 들쭉날쭉해져 픽셀아트 질감이 깨진다.
  3. 배경 제거 — 마젠타(#FF00FF 계열)를 투명으로. 사무실에 없는 색이라 오브젝트를 안 갉는다.
  4. 걸음 프레임 파생 — 캐릭터 정지 그림의 다리 영역만 옮겨 `-walk1` · `-walk2` 를 만든다.
     걷는 그림을 새로 그려 넣지 않는 이유는 같은 사람을 유지하기 위해서다(§걸음 프레임).

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

# 타일 한 칸의 목표 픽셀 수. **원본 시트가 이 크기로 그려져 있다** — 1 도트가 8 화면픽셀이고
# 타일 셀이 그 5배(320px)라 40px 로 떨어진다. 검출된 크기가 39~41px 로 흔들리는 것만 여기서
# 1px 이내로 스냅한다.
#
# 32px 로 내려 봤더니 세라믹 타일의 1px 가로 이음매가 있는 행이 축소에서 버려져 격자선이
# 사라졌다(2026-09-04 렌더 확인). 원본에 없는 규격으로 줄이면 정보를 버린다.
# Swift 쪽 짝은 `ConsoleCore/OfficeViewMetrics.swift` 의 `officeSpriteUnit`.
TILE_PX = 40

# 스프라이트 1개의 색 상한. 생성 AI 시트는 도트 블록 안쪽에도 음영이 있어, 블록 중앙을
# 정확히 뽑아도 블록마다 색이 달라진다 — 재정합 전 102개 중 95개가 이 상한을 넘었고
# 중앙값이 535색이었다(`PALETTE-BASELINE.md`). 양자화가 그 뒤를 받는다.
PALETTE_MAX = 64

# 타일·가구·소품이 함께 쓰는 공통 팔레트의 색 수. 파일마다 따로 양자화하면 같은 재질이
# 파일 간에 갈린다(`shared_palette` 주석의 나무 타일 실측). 캐릭터는 여기서 빠진다.
SHARED_PALETTE_MAX = 64

# 걸음 프레임을 만들 포즈. 앉은 자세는 걷지 않으므로 뺀다.
WALK_POSES = ("down", "up", "side")

# 정면·후면에서 드는 다리 높이(픽셀). 다리 길이가 11px 이라 2px 면 발이 뜬 것이 눈에
# 보이고, 그 이상 올리면 신발이 종아리에 잠겨 다리가 뭉툭해진다.
LEG_LIFT = 2

# 측면에서 무릎 아래를 앞뒤로 미는 거리(픽셀). 측면은 두 다리가 한 덩어리라 교차를 만들
# 수 없어, 다리 전체를 앞뒤로 흔들어 보폭으로 읽히게 한다.
#
# 2 인 이유(실측): 화면에서는 54px 원본이 32px 로 축소돼 프레임 차이가 절반으로 줄어든다.
# 1px 이면 두 프레임 차이가 11픽셀까지 떨어져 정면(25픽셀)에 비해 걸음이 안 읽히고,
# 3px 이면 허리 아래가 통째로 밀려 몸이 꺾여 보인다. 2px 가 19픽셀로 둘 사이에 든다.
SIDE_SWING = 2

# 측면 무릎 높이 — 스프라이트 높이에 대한 비율. 실측(53px 스프라이트에서 y=46)에서 왔다.
# 이보다 위에서 밀면 허리부터 어긋나 몸이 꺾여 보이고, 아래면 신발만 떨어져 나간다.
SIDE_KNEE_RATIO = 0.87

# 셀 순서 → 파일명. 검출은 위→아래·왼→오른쪽 읽기 순서로 정렬된다.
# 캐릭터 좌/우는 미러 불일치가 3.7% 라 한 장만 쓰고 코드에서 뒤집는다(4번 셀은 버린다).
SHEETS: dict[str, list[str | None]] = {
    "character-base": ["char-down", "char-up", "char-side", None, "char-sit"],
    # 추가 캐릭터 시트(선택) — 없으면 건너뛴다. 있으면 사람마다 다른 시트가 배정돼
    # 얼굴·체형까지 갈린다. 규격은 base 와 동일(5포즈 한 줄, 마젠타 배경).
    "character-b": ["charb-down", "charb-up", "charb-side", None, "charb-sit"],
    "character-c": ["charc-down", "charc-up", "charc-side", None, "charc-sit"],
    "character-d": ["chard-down", "chard-up", "chard-side", None, "chard-sit"],
    "character-e": ["chare-down", "chare-up", "chare-side", None, "chare-sit"],
    # 바닥·벽 타일은 `draw-tiles.py` 가 코드로 굽는다 — 40x40 반복 패턴이라 밑색·이음매·무늬를
    # 규칙으로 적는 편이 정확하고, 그래야 여섯 부서 밝기를 한 축에서 나란히 잡을 수 있다.
    # 여기를 비워 두지 않으면 다른 raw 시트를 갱신하려고 이 스크립트를 돌릴 때마다 절차형 타일이
    # 조용히 옛 AI 타일로 되돌아가고, 함께 조정한 `muteStrength` 와도 어긋난다.
    "tiles-floor": [None, None, None, None, None, None],
    "furniture": [
        None,  # furniture-desk-top 이 정본(위에서 내려다본 재제작본)
        "furn-chair-down",
        "furn-chair-up",
        None,  # furniture-4 가 정본(의자 없는 재제작본)
        "furn-sofa-2",
        None,  # furniture-4 가 정본(폭을 넓힌 재제작본)
        None,  # furniture-4 가 정본(낮고 넓은 재제작본)
        "furn-coffee-machine",
        "furn-water-cooler",
        None,  # furniture-3 이 정본(세로로 긴 재제작본)
        None,  # furniture-4 가 정본(좁게 재제작)
        None,  # furniture-4 가 정본(세로로 늘린 재제작본)
        None,  # furniture-3 이 정본
        "furn-plant-small",
        "furn-clock",
        "furn-trash",
    ],
    "furniture-wall": [
        "furn-wall-landscape",
        "furn-wall-abstract",
        "furn-wall-calendar",
        "furn-wall-certificate",
        "furn-wall-pinboard",
        "furn-wall-whiteboard",
        "furn-wall-shelf",
        "furn-wall-monitor",
        "furn-wall-poster",
        "furn-wall-plant-hanging",
    ],
    "furniture-door": [
        None,  # furniture-3 이 정본
        None,  # furniture-3 이 정본
        None,  # furniture-4 가 정본(3단 서랍 비율로 재제작)
        None,  # furniture-4 가 정본(세로로 긴 재제작본)
        "furn-partition-low",
    ],
    "furniture-2": [
        None,  # furniture-4 가 정본(좁게 재제작)
        None,  # furniture-4 가 정본(좁게 재제작)
        "furn-sink-counter",
        "furn-partition-glass",
    ],
    # 이 세 종은 `draw-props.py` 가 도트로 그린다 — 생성 AI 는 이 크기(5~12도트)에서 형태를
    # 못 잡는다. 실측하면 AI 판 `prop-desk-lamp` 는 8x11 의 88픽셀에 32색이라 색/픽셀이 1.00 이고
    # (모든 픽셀이 다른 색) 램프로 안 읽혔다. `prop-papers` 0.98 · `prop-plant-desk` 0.86 도 같다.
    # 대조군은 도트로 그린 `prop-mug`(3색) · `prop-laptop`(6색) — 7~12픽셀인데도 형태가 읽힌다.
    "props-2": [None, None, None],
    "rugs": ["furn-rug-green", "furn-rug-beige", "furn-rug-navy"],
    # 문·책장·화이트보드 재제작본. 기존 시트의 같은 이름 셀은 None 으로 비웠다 —
    # 두 시트가 같은 파일을 만들면 SHEETS 순서에 따라 승자가 갈려 조용히 어긋난다.
    "furniture-3": [
        "furn-door-closed",
        "furn-door-open",
        "furn-bookshelf",
        "furn-whiteboard",
    ],
    # 위에서 내려다본 책상. 예전 그림은 정면도라 모니터 화면이 화면 앞쪽을 봤는데 앉은 사람도
    # 앞쪽을 봐서, 서른두 좌석 전부가 **모니터 뒷판을 마주하고** 있었다.
    #
    # 배치가 좌석 방향에 맞춰져 있다 — 좌석은 책상 **위 칸**이므로, 사람에서 먼 쪽(아래)에
    # 모니터가 서고 화면 발광이 위를 향하며, 키보드·마우스가 그 사이에 눕고 서랍장은 상판
    # 아래로 빠진다. 그래서 뒤집지 않고 그대로 쓴다.
    "furniture-desk-top": ["furn-desk"],
    # 가로세로비 재제작본. 크기는 높이(cm)로만 환산하는데 배율이 가로에도 같이 곱해지므로,
    # 그림 자체의 비율이 실물과 다르면 키를 맞추는 순간 폭이 어긋난다 — 실측하면 사물함이
    # 실물의 2.4배, 서류함 2.1배, 프린터 1.7배로 넓고 커피테이블은 0.6배로 좁았다.
    # 회의 테이블은 의자를 함께 그려 여덟 자리가 늘 빈 채였고, 이제 의자가 없다.
    #
    # 네 행(낮고 넓은 것 → 중간 → 높은 것 → 큰 것 하나)으로 받았다. 행 판정이 평균 높이의
    # 60% 를 기준으로 묶으므로 한 행 안의 높이를 비슷하게 맞춰야 순서가 안 흔들린다.
    "furniture-4": [
        "furn-coffee-table",
        "furn-sofa-3",
        "furn-refrigerator",
        "furn-printer",
        "furn-filing-cabinet",
        "furn-vending-machine",
        "furn-plant-tall",
        "furn-lockers-2",
        "furn-meeting-table",
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


def soften_wood(image: Image.Image) -> Image.Image:
    """가구의 주황 나무색을 연한 베이지로 옮긴다. 캐릭터는 대상이 아니다.

    바닥을 밝은 회백색으로 통일한 뒤 주황 상판만 화면에서 튀었다(책상은 좌석마다 하나씩
    깔려 화면에서 가장 많이 반복되는 가구다). 색조(주황 15~45도)만 골라 **채도를 절반으로
    낮추고 명도를 올린다** — 형태와 명암 단계는 건드리지 않으므로 나뭇결이 남는다.

    캐릭터를 제외하는 이유는 런타임 리컬러가 밝기·채도 임계값으로 머리·셔츠·바지를 가르기
    때문이다(`SpriteLoader.swift:43-47`). 살색도 이 색조 범위에 들어간다.
    """
    import colorsys

    rgba = image.convert("RGBA")
    pixels = list(rgba.getdata())
    out = []
    for red, green, blue, alpha in pixels:
        if alpha <= 8:
            out.append((red, green, blue, alpha))
            continue
        hue, light, sat = colorsys.rgb_to_hls(red / 255, green / 255, blue / 255)
        degrees = hue * 360
        if 8 <= degrees <= 50 and sat > 0.12:
            # 채도를 절반 이하로 깎고 명도를 크게 올렸더니 상판이 바닥(밝기 207~227)과 같아져
            # 책상이 묻혔다. 색조는 남기고 **바닥보다 한 단 어둡게** 두어 윤곽이 살아 있게 한다.
            #
            # 곱셈만으로는 어두운 픽셀이 거의 안 올라간다. 책상(밝기 120)을 기준으로 계수를
            # 맞췄더니 책장·문(73~109)은 그대로 어두운 덩어리로 남았고, 바닥이 216~244 로
            # 밝아진 뒤에는 그 격차가 세 배가 됐다(사람 셔츠 186 보다도 어두웠다).
            #
            # 곱을 줄이고 더하기를 키워 **어두운 쪽을 더 많이 올린다.** 밝은 픽셀은 상한에
            # 눌려 조금만 오르므로 회의 테이블(170 → 178)이 바닥에 묻히지 않는다.
            sat *= 0.5
            light = min(1.0, light * 0.62 + 0.36)
            r2, g2, b2 = colorsys.hls_to_rgb(hue, light, sat)
            out.append((round(r2 * 255), round(g2 * 255), round(b2 * 255), alpha))
        else:
            out.append((red, green, blue, alpha))
    result = Image.new("RGBA", rgba.size)
    result.putdata(out)
    return result


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


def opaque_color_count(image: Image.Image) -> int:
    """불투명 픽셀의 고유색 수. `scripts/measure-palette.py` 와 같은 잣대다."""
    rgba = image.convert("RGBA")
    return len({pixel for pixel in rgba.getdata() if pixel[3] > 8})


def shared_palette(images: list[Image.Image], colors: int) -> Image.Image:
    """여러 스프라이트의 색을 모아 공통 팔레트를 만든다.

    파일마다 따로 양자화하면 같은 재질이 파일 간에 갈린다 — 실측으로 tile-wood-a 와
    tile-wood-b 가 각각 64색인데 공유가 15색뿐이고 서로 3 이내로 다른 색 쌍이 894개였다
    (2026-09-04). 두 타일은 번갈아 깔려 나무 무늬를 만들므로, 그 차이가 화면에서 얼룩이 된다.

    투명 픽셀은 넣지 않는다 — 투명부의 검정이 팔레트 한 칸을 차지해 실제 색이 밀린다.
    """
    pixels: list[tuple[int, int, int]] = []
    for image in images:
        rgba = image.convert("RGBA")
        pixels.extend(pixel[:3] for pixel in rgba.getdata() if pixel[3] > 8)
    if not pixels:
        pixels = [(0, 0, 0)]
    # 색 분포만 쓰므로 배치는 무관하다. 한 줄로 이어붙인다.
    canvas = Image.new("RGB", (len(pixels), 1))
    canvas.putdata(pixels)
    return canvas.quantize(
        colors=colors, method=Image.MEDIANCUT, dither=Image.Dither.NONE
    )


def apply_palette(image: Image.Image, palette: Image.Image) -> Image.Image:
    """공통 팔레트로 색을 옮긴다. 알파는 그대로 되돌려 붙인다."""
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    reduced = rgba.convert("RGB").quantize(palette=palette, dither=Image.Dither.NONE)
    result = reduced.convert("RGBA")
    result.putalpha(alpha)
    return result


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


# === 걸음 프레임 ===
#
# 생성 AI 로 걷는 그림을 다시 뽑지 않고 **기존 도트를 변형해** 만든다. 다시 뽑으면 같은
# 사람을 유지하기 어렵다(타일 이음선에서 이미 겪은 계열의 문제) — 29명이 서로 다른
# 사람으로 보이는 것이 색 교체의 전제라, 실루엣이 프레임마다 흔들리면 그게 무너진다.
#
# 캔버스 크기는 정지 그림과 **같게 유지한다**(trim 금지). 프레임마다 높이가 달라지면
# 발 위치와 머리 위 이름표가 걸음마다 튄다.


def opaque_runs(image: Image.Image, y: int) -> list[tuple[int, int]]:
    """한 행의 불투명 구간들. 정면·후면 다리는 여기서 두 덩어리로 나온다."""
    pixels = image.load()
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for x in range(image.width):
        solid = pixels[x, y][3] >= 16
        if solid and start is None:
            start = x
        if not solid and start is not None:
            runs.append((start, x - 1))
            start = None
    if start is not None:
        runs.append((start, image.width - 1))
    return runs


def leg_band(image: Image.Image) -> tuple[int, int] | None:
    """두 다리가 픽셀로 갈린 구간(top, bottom). 아래에서 위로 훑는다.

    정면·후면 그림은 두 다리 사이에 1~2px 틈이 있어 "한 행에 덩어리가 둘" 로 검출된다.
    측면은 다리가 겹쳐 늘 한 덩어리라 None 이 돌아온다 — 호출자가 다른 변환을 쓴다.
    """
    bottom: int | None = None
    top: int | None = None
    for y in range(image.height - 1, -1, -1):
        if len(opaque_runs(image, y)) == 2:
            if bottom is None:
                bottom = y
            top = y
        elif bottom is not None:
            break
    if bottom is None or top is None:
        return None
    return (top, bottom)


def lift_leg(image: Image.Image, band: tuple[int, int], which: str) -> Image.Image | None:
    """다리 한쪽을 위로 들어올린다 — 발을 뗀 순간."""
    top, bottom = band
    # 다리의 좌우 경계는 밴드 가운데 행에서 읽는다. 발끝 행은 폭이 좁아져 기준이 안 된다.
    runs = opaque_runs(image, (top + bottom) // 2)
    if len(runs) != 2:
        return None
    span = runs[0] if which == "left" else runs[1]
    result = image.copy()
    source = image.load()
    target = result.load()
    for y in range(top, bottom + 1):
        for x in range(span[0], span[1] + 1):
            origin_y = y + LEG_LIFT
            target[x, y] = source[x, origin_y] if origin_y <= bottom else (0, 0, 0, 0)
    return result


def swing_lower_body(image: Image.Image, offset: int) -> Image.Image:
    """무릎 아래를 앞뒤로 민다 — 측면 보폭."""
    knee = int(image.height * SIDE_KNEE_RATIO)
    result = image.copy()
    source = image.load()
    target = result.load()
    for y in range(knee, image.height):
        for x in range(image.width):
            origin_x = x - offset
            target[x, y] = (
                source[origin_x, y] if 0 <= origin_x < image.width else (0, 0, 0, 0)
            )
    return result


def walk_frames(image: Image.Image, pose: str) -> list[Image.Image] | None:
    """정지 그림 → 걸음 2프레임. 변환이 불가능하면 None(호출자가 건너뛴다)."""
    if pose == "side":
        return [
            swing_lower_body(image, -SIDE_SWING),
            swing_lower_body(image, SIDE_SWING),
        ]
    band = leg_band(image)
    if band is None:
        return None
    frames = [lift_leg(image, band, "left"), lift_leg(image, band, "right")]
    return None if any(frame is None for frame in frames) else frames  # type: ignore[return-value]


def solid_count(image: Image.Image) -> int:
    pixels = image.load()
    return sum(
        1
        for y in range(image.height)
        for x in range(image.width)
        if pixels[x, y][3] >= 16
    )


def save_walk_frames(sprite: Image.Image, name: str, sheet_name: str) -> int:
    """정지 스프라이트에서 걸음 프레임을 파생해 저장한다. 저장한 장수를 돌려준다.

    자체 검증: 크기가 정지 그림과 같고, 실제로 달라졌고, 몸의 절반 이상이 남아 있어야
    한다. 원본 그림이 바뀌어 다리 검출이 어긋나면 여기서 걸린다 — 조용히 이상한 프레임이
    깔리면 화면에서는 "걷다가 다리가 사라지는 사람" 으로만 보인다.

    대상은 **캐릭터 시트에서 온 것만**이다. 포즈 이름만 보면 `furn-chair-down` 처럼
    방향으로 끝나는 가구가 함께 걸려 의자 걸음 프레임이 만들어진다.
    """
    if not sheet_name.startswith("character"):
        return 0
    pose = name.rsplit("-", 1)[-1]
    if pose not in WALK_POSES:
        return 0
    frames = walk_frames(sprite, pose)
    if frames is None:
        # 이전 실행이 남긴 프레임을 지운다. 정지 그림만 새로 바뀌고 걸음 프레임이 옛것으로
        # 남으면 로더도 테스트도 "파일이 있으니 정상" 으로 보고, 걷는 순간 다른 사람이 된다.
        # 경고만 남기고 지나가면 이 불일치가 조용히 커밋된다.
        stale = sorted(OUT.glob(f"{name}-walk*.png"))
        for path in stale:
            path.unlink()
        removed = f" · 낡은 프레임 {len(stale)}장 제거" if stale else ""
        print(f"  ⚠️ {name}: 다리를 못 찾아 걸음 프레임 생략{removed} — 코드가 정지 그림으로 폴백")
        return 0
    base = solid_count(sprite)
    saved = 0
    for index, frame in enumerate(frames, start=1):
        assert frame.size == sprite.size, f"{name}-walk{index}: 크기가 정지 그림과 다르다"
        assert frame.tobytes() != sprite.tobytes(), f"{name}-walk{index}: 변환이 안 됐다"
        assert solid_count(frame) > base * 0.5, f"{name}-walk{index}: 몸이 절반 넘게 날아갔다"
        frame.save(OUT / f"{name}-walk{index}.png")
        saved += 1
    print(f"  {name}-walk1·2.png  {sprite.width}x{sprite.height}")
    return saved


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    # 1패스에서 굽고 모아 두었다가, 공통 팔레트를 만든 뒤 2패스에서 저장한다.
    baked: list[tuple[str, Image.Image, str]] = []
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
                # 자른 뒤에 규격을 맞춘다 — 먼저 맞추면 1px 손실이 규격을 다시 깨뜨린다.
                # 타일은 반복해 깔리므로 정확한 정사각이어야 이음매가 맞는다.
                sprite = sprite.resize((TILE_PX, TILE_PX), Image.NEAREST)
            # 가구·캐릭터는 규격을 강제하지 않는다. 화면에서 실물 크기(`targetHeightCm`)를 기준으로
            # 스케일되므로(`OfficeFloorPlan.swift:1099` 가 원본 높이를 나눈다), 원본 크기를 바꾸면
            # 그 계산의 입력이 흔들려 실물 비율이 어긋난다. 짧은 변을 32의 배수로 맞춰 봤더니
            # prop-papers 가 10x6 에서 53x32 로 5배 부풀었다(2026-09-04). 이들의 도트 정합은
            # 원본 크기가 아니라 화면 스케일에서 해결한다.
            baked.append((name, sprite, sheet_name))

    # 팔레트를 공유하는 것은 **타일뿐**이다. 타일은 같은 재질이 여러 파일에 걸쳐 반복해 깔리므로
    # 파일마다 색이 갈리면 얼룩이 된다(파일별 양자화 시 tile-wood-a 와 tile-wood-b 의 공유색이
    # 64색 중 15색뿐이고 서로 3 이내로 다른 색 쌍이 894개였다).
    #
    # 가구·소품·캐릭터는 공유하지 않는다. 가구 45종을 한 팔레트에 넣어 봤더니 채도 높은 물건이
    # 표를 독점해 회색 계열이 5색만 받았고, 세라믹 타일의 격자선이 배경과 뭉쳐 사라지면서 남은
    # 픽셀이 엉뚱한 청록·베이지로 매핑됐다(2026-09-04 렌더 확인). 서로 다른 물건은 색을 나눌
    # 이유가 없고, 나눠 쓰면 서로를 밀어낸다.
    #
    # 캐릭터는 더 강한 이유로 빠진다 — 런타임 리컬러가 밝기·채도 임계값으로 머리·셔츠·바지를
    # 가르므로(`SpriteLoader.swift:43-47, 104-106`), 색을 뭉치면 그 판정이 밀려 사람마다 옷 색이
    # 뒤섞인다. 파일별 양자화가 그 대역을 지키는지는 실측했다(변화 3~5%).
    tiles = [sprite for name, sprite, _ in baked if name.startswith("tile-")]
    tile_palette = shared_palette(tiles, SHARED_PALETTE_MAX)
    total = 0
    for name, sprite, sheet_name in baked:
        # 가구·소품의 주황 나무색만 연하게. 캐릭터는 리컬러 색 규약이 걸려 있어 건드리지 않고,
        # 바닥·벽 타일은 `draw-tiles.py` 가 밝기까지 정해서 굽으므로 여기서 다시 손대면 그 값이 깨진다.
        if not name.startswith("char") and not name.startswith("tile-"):
            sprite = soften_wood(sprite)
        if name.startswith("tile-"):
            sprite = apply_palette(sprite, tile_palette)
        else:
            sprite = quantize_sprite(sprite, PALETTE_MAX)
        colors = opaque_color_count(sprite)
        if colors > PALETTE_MAX:
            print(f"✗ {name}: 색 {colors}개 — 상한 {PALETTE_MAX} 초과")
            return 1
        # 양자화 뒤에 걸음 프레임을 파생한다 — 파생은 픽셀을 옮기기만 하므로 같은 팔레트를
        # 물려받는다. 타일이 아닌 것은 파생이 끝난 뒤에 규격 비율로 줄인다.
        sprite.save(OUT / f"{name}.png")
        print(f"  {name}.png  {sprite.width}x{sprite.height}")
        total += 1
        total += save_walk_frames(sprite, name, sheet_name)
    print(f"\n{total}개 스프라이트 → {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
