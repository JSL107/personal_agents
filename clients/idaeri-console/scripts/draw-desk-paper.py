#!/usr/bin/env python3
"""책상 위에 쌓는 서류 낱장 한 장을 도트 매트릭스에서 그린다.

7×4 도트라 생성 AI 로는 형태가 안 잡힌다 — 그 크기에서는 외곽선 한 줄이 실루엣의 전부다.
장수별 그림을 따로 두지 않고 이 한 장을 코드에서 어긋나게 겹쳐 쌓는다(`OfficeScene`).

    python3 scripts/draw-desk-paper.py

의존성 없음. PNG 를 표준 라이브러리로 직접 쓴다 — 28 픽셀짜리 이미지 한 장 때문에 Pillow 를
깔게 하지 않으려는 것이고, 실제로 이 저장소의 어느 인터프리터에도 Pillow 가 없다.
(큰 시트를 다루는 `build-sprites.py` 는 리샘플링·배경 제거가 필요해 계속 Pillow 를 쓴다.)
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "Sources/IdaeriConsole/Resources/sprites/desk-paper.png"

# 색은 기존 가구 스프라이트 실측값을 그대로 쓴다. 외곽선은 전 가구가 순검정이라 여기도 같다.
PALETTE = {
    ".": None,  # 투명
    "K": (0, 0, 0),  # 외곽선
    "p": (245, 245, 240),  # 종이
    "P": (206, 206, 198),  # 종이 그늘 — 겹쳐 쌓았을 때 아래 장과의 층을 가른다
}

# 위에서 아래로 읽는다. 글자 하나가 1 도트.
# 네 귀를 비워 종이 모서리가 죽은 형태로 만든다 — 꽉 찬 사각형이면 책상 위 카드처럼 보인다.
PAPER = """
.KKKKK.
KpppppK
KPPPPPK
.KKKKK.
"""


def rows_of(art: str) -> list[str]:
    return [line for line in art.strip("\n").split("\n") if line]


def encode_png(rows: list[str]) -> bytes:
    """도트 그림을 RGBA PNG 바이트로 인코딩한다."""
    width = max(len(row) for row in rows)
    raw = bytearray()
    for row in rows:
        raw.append(0)  # 행마다 필터 타입 0(None) — 이 크기에서 필터는 이득이 없다
        for x in range(width):
            symbol = row[x] if x < len(row) else "."
            color = PALETTE[symbol]
            raw.extend((0, 0, 0, 0) if color is None else (*color, 255))

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    # 비트깊이 8 · 컬러타입 6(RGBA) · 압축/필터/인터레이스 기본값.
    header = struct.pack(">IIBBBBB", width, len(rows), 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def main() -> None:
    rows = rows_of(PAPER)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(encode_png(rows))
    print(f"{OUT.name} {max(len(row) for row in rows)}×{len(rows)}")


if __name__ == "__main__":
    main()
