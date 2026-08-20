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
    # 이 세 종은 draw-props.py의 임시 도트 그림을 AI 에셋으로 교체한다.
    "props-2": ["prop-papers", "prop-desk-lamp", "prop-plant-desk"],
    "rugs": ["furn-rug-green", "furn-rug-beige", "furn-rug-navy"],
    # 문·책장·화이트보드 재제작본. 기존 시트의 같은 이름 셀은 None 으로 비웠다 —
    # 두 시트가 같은 파일을 만들면 SHEETS 순서에 따라 승자가 갈려 조용히 어긋난다.
    "furniture-3": [
        "furn-door-closed",
        "furn-door-open",
        "furn-bookshelf",
        "furn-whiteboard",
    ],
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
            total += save_walk_frames(sprite, name, sheet_name)
    print(f"\n{total}개 스프라이트 → {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
