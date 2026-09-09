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
# 흩어져 있으면 "돌려야 하는 줄 몰랐다" 가 생긴다. 네 게이트가 각각 무엇을 보는지:
#   swift build             타입·컴파일
#   ConsoleCoreTests        배치·조판·색 규칙 (단언 9700+)
#   --color-check           오피스 렌더 픽셀의 실제 밝기 (통로·바닥·가구·셔츠 대역)
#   --render-dashboard      대시보드 카드가 실제로 그려지는지 (라이트·다크 두 장)
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

# 대시보드는 픽셀 대역을 재지 않고 "굽히는지" 만 본다 — 카드가 SwiftUI 조판에서 터지거나
# 스프라이트가 번들에서 사라지면 여기서 exit 1 이 된다. 산출물은 눈으로 볼 때만 쓰므로
# 임시 디렉터리에 굽고 지운다.
echo "── 대시보드 렌더 (라이트·다크)"
DASHBOARD_RENDER_DIR="$(mktemp -d)"
trap 'rm -rf "$DASHBOARD_RENDER_DIR"' EXIT
swift run IdaeriConsole --render-dashboard "$DASHBOARD_RENDER_DIR/dashboard-light.png"
swift run IdaeriConsole --render-dashboard "$DASHBOARD_RENDER_DIR/dashboard-dark.png" --dark

echo "✓ 콘솔 게이트 전부 통과"
