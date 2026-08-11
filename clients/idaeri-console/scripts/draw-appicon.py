#!/usr/bin/env python3
"""Dock 아이콘(Resources/appicon.png)을 오피스 스프라이트에서 합성한다.

앱은 `.app` 번들 없이 SwiftPM 실행 파일로 뜨므로 macOS 가 아이콘을 찾을 곳이 없다.
main.swift 가 이 PNG 를 `applicationIconImage` 에 직접 물려 기본 실행파일 아이콘
(검은 `exec`)을 대체한다.

그림은 사무실 화면과 같은 스프라이트를 쓴다 — 아이콘만 따로 그리면 앱을 고칠 때마다
아이콘이 뒤처지고, 두 그림의 톤이 갈린다.

    python3 scripts/draw-appicon.py

의존성: Pillow (pip install pillow)
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("Pillow 가 필요하다: pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
SPRITES = ROOT / "Sources/IdaeriConsole/Resources/sprites"
OUTPUT = ROOT / "Sources/IdaeriConsole/Resources/appicon.png"

SIZE = 1024
# macOS 아이콘은 캔버스를 꽉 채우지 않는다 — 여백과 모서리 반경은 Big Sur 이후 관례값.
INSET = 100
RADIUS = int((SIZE - 2 * INSET) * 0.2237)

# 배경 그라데이션. 오피스 씬의 야간 톤에서 뽑은 남색이라 Dock 의 밝은 아이콘들 사이에서
# 눈에 띄면서도 앱 화면과 같은 색으로 읽힌다.
GRADIENT_TOP = (72, 90, 140)
GRADIENT_BOTTOM = (34, 42, 72)

CHARACTER_SCALE = 10
DESK_SCALE = 15
# 캐릭터에서 책상 상판 위로 드러나는 비율. 나머지 하반신은 책상에 가려진다 —
# 앉은 스프라이트는 원래 책상 뒤에 놓이는 그림이라 전신을 보이면 다리가 떠 보인다.
VISIBLE_RATIO = 0.55


def load_sprite(name: str, scale: int) -> Image.Image:
    """스프라이트를 정수배로 확대한다. 보간은 nearest — 도트 경계가 흐려지면 안 된다."""
    image = Image.open(SPRITES / f"{name}.png").convert("RGBA")
    return image.resize((image.width * scale, image.height * scale), Image.NEAREST)


def rounded_mask() -> Image.Image:
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [INSET, INSET, SIZE - INSET, SIZE - INSET], radius=RADIUS, fill=255
    )
    return mask


def build() -> Image.Image:
    canvas = Image.new("RGBA", (SIZE, SIZE))
    painter = ImageDraw.Draw(canvas)
    for y in range(SIZE):
        ratio = y / (SIZE - 1)
        color = tuple(
            int(top + (bottom - top) * ratio)
            for top, bottom in zip(GRADIENT_TOP, GRADIENT_BOTTOM)
        )
        painter.line([(0, y), (SIZE, y)], fill=color + (255,))

    character = load_sprite("char-sit", CHARACTER_SCALE)
    desk = load_sprite("furn-desk", DESK_SCALE)

    # 캐릭터 + 책상을 한 덩어리로 보고 콘텐츠 영역 안에서 세로 중앙에 놓는다.
    # 따로 배치하면 책상이 아이콘 아래로 잘려 나간다.
    overlap = int(character.height * VISIBLE_RATIO)
    group_height = overlap + desk.height
    character_y = INSET + ((SIZE - 2 * INSET) - group_height) // 2

    canvas.alpha_composite(character, ((SIZE - character.width) // 2, character_y))
    canvas.alpha_composite(desk, ((SIZE - desk.width) // 2, character_y + overlap))

    icon = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    icon.paste(canvas, (0, 0), rounded_mask())
    return icon


if __name__ == "__main__":
    icon = build()
    # 32px(메뉴바·최소 Dock)까지 줄여도 실루엣이 남는지가 아이콘의 합격선이다.
    assert icon.getbbox() is not None, "아이콘이 비었다 — 스프라이트 경로를 확인하라"
    corner = icon.getpixel((0, 0))
    assert corner[3] == 0, f"모서리가 불투명하다({corner}) — 라운드 마스크가 안 먹었다"
    icon.save(OUTPUT)
    print(f"✓ {OUTPUT.relative_to(ROOT)} ({icon.width}x{icon.height})")
