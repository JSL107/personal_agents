#!/usr/bin/env bash
# 콘솔(픽셀 오피스) 검증 게이트 — 한 명령으로 모아 둔다.
#
#   pnpm console:check
#
# **CI 가 이것을 못 돌린다.** `.github/workflows/ci.yml` 의 러너가 `ubuntu-latest` 이고,
# 콘솔은 SpriteKit·AppKit·CoreGraphics 위에 서 있어 리눅스에는 프레임워크 자체가 없다.
# macOS 러너를 붙이면 되지만 GitHub 호스티드 macOS 는 분당 과금이 10배라 그 결정을 먼저
# 해야 한다 — 그래서 콘솔을 고친 세션이 직접 돌리는 로컬 게이트로 둔다.
#
# 흩어져 있으면 "돌려야 하는 줄 몰랐다" 가 생긴다. 세 게이트가 각각 무엇을 보는지:
#   swift build             타입·컴파일
#   ConsoleCoreTests        배치·조판·색 규칙 (단언 9700+)
#   --color-check           렌더 픽셀의 실제 밝기 (통로·바닥·가구·셔츠 대역)
#
# 색 실측은 백엔드가 필요 없다(고정 명단으로 굽는다). 시각도 고정하므로 회차마다 같은 값이 나온다.
set -euo pipefail

CONSOLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../clients/idaeri-console" && pwd)"
cd "$CONSOLE_DIR"

echo "── swift build"
swift build

echo "── ConsoleCoreTests"
swift run ConsoleCoreTests

echo "── 색 실측 (--color-check)"
swift run IdaeriConsole --color-check

echo "✓ 콘솔 게이트 전부 통과"
