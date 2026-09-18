#!/usr/bin/env python3
"""캐릭터 원화를 화면이 실제로 쓰는 해상도까지 줄인다.

    python3 scripts/downscale-characters.py [--height 900] [--dry-run]

**이 스크립트는 에셋을 다시 만들지 않는다 — 이미 있는 것을 줄일 뿐이다.**
`cozy/characters/*.png` 183장은 생성 AI 산출물을 그대로 커밋한 것이라
`build-sprites.py` 로 재생성할 수 없다(`Resources/raw/` 에는 시트 15장만 있고
183장의 소스가 아니다). 그래서 원본 화질이 필요하면 git 히스토리에서 꺼내
이 스크립트를 다른 `--height` 로 다시 돌리는 것이 유일한 경로다.

기본값이 900px 인 근거는 **화면에 그려지는 최대 픽셀 수**다. 방을 확대하면
캐릭터 텍스처 전체가 아래 사슬만큼 늘어나 그려진다.

    표시 픽셀 = 100(maximumHeight) × 1.0(visualScale)
              × (tileSize / 40)    ← officeReferenceTileSize
              × 0.85               ← officeCharacterScaleFactor
              × 0.72               ← CozyCharacterArtworkNode.officeScaleFactor
              × 2                  ← backingScale(레티나)
    tileSize = min(창폭 / 11, 창높이 / 7)   ← zoneWidth + 1, zoneHeight

깊이 축소(`officeFloorDepthScale`)는 `min(1, ...)` 이라 1 을 넘지 못하므로 앞줄에
선 캐릭터가 상한이다. Studio Display 5K 전체화면(2560×1440pt)에서 629px,
6K XDR 이 붙어도 740px 이라 900px 은 어느 쪽에서도 늘려 쓰이지 않는다.

**절반(687px)까지 줄이면 5K 전체화면에서 업스케일이 시작된다** — #602 가 알파
경계 측정용 축소본을 화면에도 쓰다가 머리카락 결이 뭉개진 그 회귀다. 줄이기
전에 위 사슬로 최악 표시 픽셀을 다시 계산할 것.

투명 여백은 **일부러 남긴다.** 잘라내도 용량은 오히려 조금 늘고(PNG 가 균일한
투명 영역을 거의 공짜로 압축한다), 런타임 크롭
(`SpriteLoader.imageByCroppingTransparentMargins`)이 여백을 전제로 서 있다.

의존성: Pillow (pip install pillow)
"""

from __future__ import annotations

import argparse
import io
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow 가 필요하다: pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
CHARACTERS = ROOT / "Sources/IdaeriConsole/Resources/cozy/characters"
DEFAULT_HEIGHT = 900


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--height", type=int, default=DEFAULT_HEIGHT)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    files = sorted(CHARACTERS.glob("*.png"))
    if not files:
        sys.exit(f"캐릭터 PNG 를 찾지 못했다: {CHARACTERS}")

    before = after = skipped = 0
    for path in files:
        source_bytes = path.stat().st_size
        before += source_bytes
        # `as` 로 받은 것을 재할당하지 않는다 — 재할당하면 `with` 가 닫는 것이 변환 결과라
        # 원본 핸들이 183장 내내 열린 채로 남는다.
        with Image.open(path) as source:
            image = source.convert("RGBA")
            if image.height <= args.height:
                # 이미 목표 이하인 장은 다시 굽지 않는다 — 재인코딩만으로도 알파
                # 가장자리가 미세하게 움직여 크롭 경계가 흔들린다.
                after += source_bytes
                skipped += 1
                continue
            ratio = args.height / image.height
            resized = image.resize(
                (max(1, round(image.width * ratio)), args.height), Image.LANCZOS
            )
        if args.dry_run:
            # dry-run 도 줄어들 크기를 실제로 재서 보여준다 — "얼마나 주는가" 가
            # 이 모드를 쓰는 유일한 이유라, 0 을 찍으면 모드 자체가 무의미해진다.
            buffer = io.BytesIO()
            resized.save(buffer, "PNG", optimize=True)
            after += buffer.tell()
            continue
        resized.save(path, "PNG", optimize=True)
        after += path.stat().st_size

    label = "(dry-run) " if args.dry_run else ""
    print(f"{label}{len(files)}장 · 목표 높이 {args.height}px · 건너뜀 {skipped}장")
    print(f"{label}{before / 1024 / 1024:.1f} MB → {after / 1024 / 1024:.1f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
