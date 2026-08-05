#!/usr/bin/env python3
"""책상 위 작은 소품 스프라이트를 도트 매트릭스에서 직접 그린다.

머그컵·서류더미 같은 물건은 5~12 도트라 생성 AI 가 형태를 못 잡는다(그 크기에서는
외곽선 한 줄이 실루엣의 전부라 조금만 어긋나도 무엇인지 안 읽힌다). 도트를 글자로
찍어 두면 형태가 눈에 보이고, 색은 기존 가구에서 뽑은 팔레트를 그대로 참조한다.

큰 가구는 여전히 생성 AI 담당 — scripts/ASSET-SHEET-SPEC.md 참조.

    python3 scripts/draw-props.py

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

# 기존 가구 스프라이트에서 실측한 색. 새 소품이 옆에 놓였을 때 이질적으로 보이지 않으려면
# 같은 팔레트를 써야 한다 — 특히 외곽선은 전부 순검정이다.
OUTLINE = (0, 0, 0)
WOOD = (216, 164, 114)  # furn-desk 상판
WOOD_DARK = (136, 91, 60)  # furn-coffee-machine 몸통
GRAY = (204, 203, 202)  # furn-printer 몸통
GRAY_LIGHT = (231, 231, 229)  # furn-printer 하이라이트
GRAY_DARK = (37, 39, 40)  # furn-desk 다리

PALETTE = {
    ".": None,  # 투명
    "K": OUTLINE,
    "w": WOOD,
    "W": WOOD_DARK,
    "g": GRAY,
    "G": GRAY_LIGHT,
    "d": GRAY_DARK,
    "p": (245, 245, 240),  # 종이 흰색
    "P": (206, 206, 198),  # 종이 그늘
    "c": (196, 82, 72),  # 머그 빨강
    "C": (150, 58, 50),  # 머그 빨강 그늘
    "b": (88, 122, 168),  # 책 파랑
    "B": (62, 88, 124),  # 책 파랑 그늘
    "n": (108, 156, 108),  # 책 초록
    "N": (74, 116, 76),  # 책 초록 그늘
    "y": (232, 196, 96),  # 스탠드 전구빛
    "e": (60, 62, 66),  # 노트북 화면 (꺼짐)
    "s": (120, 172, 200),  # 노트북 화면 (켜짐)
    "S": (168, 208, 228),  # 노트북 화면 반사
    "l": (150, 196, 150),  # 잎 밝은 면
    "o": (94, 62, 44),  # 커피
}

# 각 소품은 위에서 아래로 읽는 도트 그림이다. 글자 하나가 1 도트.
#
# 크기 기준: 바닥 타일 한 칸이 약 40 도트, 책상이 37 도트 폭. 책상 위에 얹는 물건이라
# 5~12 도트로 잡았다 — 이보다 크면 책상의 모니터·키보드와 자리를 다툰다.

MUG = """
.KKKK..
KppppK.
KpoopKK
Kpoop.K
KppppKK
.KKKK..
"""

# 화면에 사선 반사를 한 줄 넣는다. 단색으로 두면 파란 사각형이라 노트북으로 안 읽힌다.
LAPTOP = """
.KKKKKKKKKK.
.KsssSssssK.
.KssSsssssK.
.KsSssssssK.
.KeeeeeeeeK.
KKKKKKKKKKKK
KggggggggggK
KgGGGGGGGGgK
KggggggggggK
KKKKKKKKKKKK
"""

PEN_HOLDER = """
..K.K.K..
.KbKcKnK.
.KbKcKnK.
KKbKcKnKK
KgggggggK
KgGGGGGgK
KgggggggK
KgggggggK
.KKKKKKK.
"""

# 권마다 검정 한 줄로 갈라야 "쌓인 책" 으로 읽힌다. 색만 바꿔 붙이면 줄무늬 상자가 된다.
BOOK_STACK = """
.KKKKKKKK.
KbbbbbbbbK
KBBBBBBBBK
KKKKKKKKKK
KnnnnnnnnK
KNNNNNNNNK
KKKKKKKKKK
KccccccccK
.KKKKKKKK.
"""

PROPS: dict[str, str] = {
    "prop-mug": MUG,
    "prop-laptop": LAPTOP,
    "prop-pen-holder": PEN_HOLDER,
    "prop-book-stack": BOOK_STACK,
}


def render(art: str) -> Image.Image:
    """도트 글자 그림 → RGBA 이미지."""
    rows = [line for line in art.strip("\n").split("\n") if line]
    width = max(len(row) for row in rows)
    # 행 길이가 어긋나면 짧은 행의 오른쪽이 투명으로 남아 물건에 구멍이 뚫린다. 8배로
    # 확대되기 전까지는 눈에 잘 안 띄므로 여기서 막는다.
    ragged = [index for index, row in enumerate(rows) if len(row) != width]
    if ragged:
        raise ValueError(f"행 길이 불일치(폭 {width}) — 행 {ragged}")
    image = Image.new("RGBA", (width, len(rows)), (0, 0, 0, 0))
    pixels = image.load()
    for y, row in enumerate(rows):
        for x, symbol in enumerate(row):
            color = PALETTE.get(symbol)
            if color is None:
                continue
            pixels[x, y] = (*color, 255)
    return image


def main() -> int:
    # 먼저 전부 그려 본 뒤에 저장한다. 하나라도 어긋나면 아무것도 안 남겨야
    # 반쯤 깨진 스프라이트가 sprites/ 에 섞이지 않는다.
    unknown = [
        f"{name}: {symbol!r}"
        for name, art in PROPS.items()
        for symbol in sorted(set(art) - {"\n"})
        if symbol not in PALETTE
    ]
    if unknown:
        # 팔레트에 없는 글자는 조용히 투명이 된다 — 오타로 물건에 구멍이 뚫린 채
        # 지나가지 않게 여기서 멈춘다.
        print("⚠️ 팔레트에 없는 기호: " + ", ".join(unknown))
        return 1

    rendered = {name: render(art) for name, art in PROPS.items()}

    OUT.mkdir(parents=True, exist_ok=True)
    for name, image in rendered.items():
        image.save(OUT / f"{name}.png")
        print(f"  {name}.png  {image.width}x{image.height}")
    print(f"\n{len(rendered)}개 소품 → {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
