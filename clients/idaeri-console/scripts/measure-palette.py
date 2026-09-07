#!/usr/bin/env python3
"""스프라이트·렌더 PNG 의 팔레트 상태를 재는 도구.

색 수가 많으면 도트가 뭉개져 있다는 뜻이다. 진짜 픽셀아트는 40x41 타일에 색이 10~20개고,
생성 AI 산출물을 축소한 것은 수백 개가 된다(2026-09-04 실측: tile-wood-b 865색).
"""
from __future__ import annotations

import sys
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
