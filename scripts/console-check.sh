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
# 흩어져 있으면 "돌려야 하는 줄 몰랐다" 가 생긴다. 각 게이트가 무엇을 보는지:
#   swift build             타입·컴파일
#   ConsoleCoreTests        배치·조판·색 규칙 (단언 9700+)
#   --asset-check           에셋이 다 있고 크기가 기대와 같은지 (방·가구·캐릭터·포즈·걸음)
#   --crop-check            투명 여백 잘라내기 계약 (몸 경계 보존·여백 유지·여백 상한)
#   --prewarm-check         워밍이 백그라운드에서 캐시를 채우는지 (중복 접힘 + 적재)
#   --color-check           오피스 렌더 픽셀의 실제 밝기 (통로·바닥·가구·셔츠 대역)
#   --render-dashboard      대시보드 카드가 실제로 그려지는지 (라이트·다크 두 장)
#   --render-calendar       캘린더 격자·머리글이 그려지는지 (5주 달·6주 달)
#   --render-schedule-compose  등록 폼이 그려지는지 (빈 폼·채운 폼+실패)
#
# **개수를 세어 적지 않는다.** 한때 "네 게이트" 라고 적혀 있었는데 그동안 여섯이 되어 있었고,
# 그 숫자가 낡은 것을 아무도 못 봤다 — 목록에서 빠진 검사도 같은 이유로 눈에 띄지 않았다.
#
# `--asset-check` 는 2026-09-22 까지 이 묶음에 없었다. 그래서 #616 이 캐릭터 원화를
# 1145×1374 에서 750×900 으로 줄였을 때 이 스크립트는 전부 초록을 내고 통과했지만,
# `--asset-check` 는 머지 직후부터 183장 중 163건을 "unexpected dimensions" 로 떨어뜨리며
# 종료 코드 1 을 내고 있었다(#622 가 발견해 기대 크기를 상수로 모았다). **묶음에 없는 검사는
# 돌지 않고, 돌지 않는 검사는 깨진 채로 오래 산다.** 새 `--*-check` 를 만들면 여기 함께 넣을 것.
#
# 색 실측은 백엔드가 필요 없다(고정 명단으로 굽는다). 시각도 고정하므로 회차마다 같은 값이 나온다.
set -euo pipefail

CONSOLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../clients/idaeri-console" && pwd)"
cd "$CONSOLE_DIR"

echo "── swift build"
swift build

echo "── ConsoleCoreTests"
swift run ConsoleCoreTests

# 에셋 결손·크기는 **가장 먼저** 본다. 그림이 없거나 크기가 어긋난 상태에서는 아래 검사들이
# 무엇을 통과시켰는지가 의미를 잃는다 — 크롭 계약도 색 대역도 그 그림을 전제로 재기 때문이다.
echo "── 에셋 목록·크기 (--asset-check)"
swift run IdaeriConsole --asset-check

echo "── 크롭 계약 (--crop-check)"
swift run IdaeriConsole --crop-check

echo "── 워밍 계약 (--prewarm-check)"
swift run IdaeriConsole --prewarm-check

echo "── 색 실측 (--color-check)"
swift run IdaeriConsole --color-check

# 대시보드는 픽셀 대역을 재지 않고 "굽히는지" 만 본다 — 카드가 SwiftUI 조판에서 터지거나
# 스프라이트가 번들에서 사라지면 여기서 exit 1 이 된다. 산출물은 눈으로 볼 때만 쓰므로
# 임시 디렉터리에 굽고 지운다.
echo "── 대시보드 렌더 (라이트·다크)"
RENDER_DIR="$(mktemp -d)"
trap 'rm -rf "$RENDER_DIR"' EXIT
swift run IdaeriConsole --render-dashboard "$RENDER_DIR/dashboard-light.png"
swift run IdaeriConsole --render-dashboard "$RENDER_DIR/dashboard-dark.png" --dark

# 캘린더는 앱의 첫 화면이라 여기서 터지면 아무것도 못 한다. **6주 달을 함께 굽는다** —
# 행이 하나 늘어 창 하한에서 넘치는 조판은 그 달을 굽지 않으면 드러나지 않는다.
echo "── 캘린더 렌더 (5주 달·6주 달)"
swift run IdaeriConsole --render-calendar "$RENDER_DIR/calendar-09.png"
swift run IdaeriConsole --render-calendar "$RENDER_DIR/calendar-08.png" --month 8

# 등록 폼은 `.sheet` 로 뜨는 별도 표면이라 캘린더 렌더에 담기지 않는다. 채운 폼까지 굽는 건
# 긴 제목·여러 줄 메모·실패 문구가 조판을 밀어내는지가 빈 폼에는 안 나오기 때문이다.
echo "── 등록 폼 렌더 (빈 폼·채운 폼)"
swift run IdaeriConsole --render-schedule-compose "$RENDER_DIR/compose-empty.png"
swift run IdaeriConsole --render-schedule-compose "$RENDER_DIR/compose-filled.png" --filled --failure

echo "✓ 콘솔 게이트 전부 통과"
