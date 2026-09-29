#!/usr/bin/env python3
"""Build the mechanic pixel sprites from the silver-haired character-D atlas crops.

The generated sprite files are derived from `sprites/chard-*`, which were cut from
the original magenta-background `raw/character-d.png` atlas. Only known torso rows
are recolored; face and eye rows are outside those masks. Hair is recolored from
the connected dark component seeded at the top of the head, so eyes and outlines
remain intact.
"""

from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SPRITES = ROOT / "Sources/IdaeriConsole/Resources/sprites"

# Safe shirt bounds measured from the original source crops. In particular, the
# front-facing white eyes occupy rows 21-22; shirt recoloring starts at row 23.
SHIRT_ROWS = {
    "down": (23, 36),
    "up": (21, 35),
    "side": (22, 36),
    "sit": (23, 33),
}
HAIR_ROW_LIMIT = {"down": 21, "up": 21, "side": 21, "sit": 22}


def neutral_luminance(pixel: tuple[int, int, int, int]) -> int | None:
    red, green, blue, alpha = pixel
    if alpha < 16 or max(red, green, blue) - min(red, green, blue) > 18:
        return None
    return (red * 30 + green * 59 + blue * 11) // 100


def recolor_shirt(image: Image.Image, pose: str) -> None:
    start, end = SHIRT_ROWS[pose]
    pixels = image.load()
    for y in range(start, min(end + 1, image.height)):
        for x in range(image.width):
            luminance = neutral_luminance(pixels[x, y])
            if luminance is None or luminance < 168:
                continue
            if luminance >= 238:
                color = (244, 146, 55)
            elif luminance >= 214:
                color = (222, 103, 24)
            else:
                color = (174, 72, 19)
            pixels[x, y] = (*color, pixels[x, y][3])


def recolor_hair(image: Image.Image, pose: str) -> None:
    pixels = image.load()
    row_limit = min(HAIR_ROW_LIMIT[pose], image.height)

    def is_hair_fill(x: int, y: int) -> bool:
        luminance = neutral_luminance(pixels[x, y])
        return y < row_limit and luminance is not None and 24 <= luminance <= 112

    # Seed only dark neutral pixels at the crown, then follow the connected hair
    # silhouette. The skin gap keeps brows and eyes out of this component.
    seeds = [
        (x, y)
        for y in range(min(4, row_limit))
        for x in range(image.width)
        if is_hair_fill(x, y)
    ]
    visited: set[tuple[int, int]] = set()
    queue = deque(seeds)
    while queue:
        x, y = queue.popleft()
        if (x, y) in visited or not is_hair_fill(x, y):
            continue
        visited.add((x, y))
        for offset_y in (-1, 0, 1):
            for offset_x in (-1, 0, 1):
                next_x, next_y = x + offset_x, y + offset_y
                if 0 <= next_x < image.width and 0 <= next_y < row_limit:
                    queue.append((next_x, next_y))

    for x, y in visited:
        luminance = neutral_luminance(pixels[x, y])
        assert luminance is not None
        # Keep near-black outline pixels. Lift the interior fills to the same
        # neutral silver-gray family as the cozy mechanic character.
        if luminance >= 34:
            gray = min(154, max(86, round(luminance * 1.65 + 25)))
            pixels[x, y] = (gray, gray, gray, pixels[x, y][3])


def main() -> None:
    for pose in ("down", "up", "side", "sit"):
        frame_names = [pose] if pose == "sit" else [pose, f"{pose}-walk1", f"{pose}-walk2"]
        for frame_name in frame_names:
            source_path = SPRITES / f"chard-{frame_name}.png"
            output_path = SPRITES / f"mechanic-{frame_name}.png"
            with Image.open(source_path) as source:
                image = source.convert("RGBA")
            recolor_hair(image, pose)
            recolor_shirt(image, pose)
            image.save(output_path)
            print(f"{output_path.name}: {image.width}x{image.height}")


if __name__ == "__main__":
    main()
