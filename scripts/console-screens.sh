#!/usr/bin/env bash
# 콘솔 화면 회귀 캡처 — 두 탭을 같은 창 크기로 찍어 기준 이미지와 눈으로 대조한다.
#
# 조판이 깨지는 것(겹침·잘림·여백 폭주)은 사람이 나란히 놓고 보면 즉시 안다. 그래서 픽셀
# 자동 판정을 두지 않는다 — 캐릭터가 숨쉬는 위상만으로도 픽셀은 매번 달라져서, 자동 판정을
# 쓰려면 애니메이션을 멈춰 세우는 장치가 따로 필요하고 그 비용이 얻는 것보다 크다.
#
# 사용:
#   scripts/console-screens.sh            → docs/console-screens/current/ 에 캡처
#   scripts/console-screens.sh baseline   → 기준 이미지를 갱신
#   (기준과 비교: open docs/console-screens/)
#
# 전제: 콘솔 앱이 실행 중이어야 한다(pnpm dev). 캡처 동안 창이 잠깐 앞으로 나오고
#       크기가 바뀌며, 끝나면 원래 크기로 되돌린다.
set -euo pipefail

TARGET="${1:-current}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/docs/console-screens/$TARGET"
# 캡처 크기를 고정한다 — 창 크기가 바뀌면 타일 크기·글자 크기가 함께 바뀌어
# 조판 비교가 성립하지 않는다.
WIDTH=1200
HEIGHT=820

if ! pgrep -x IdaeriConsole >/dev/null 2>&1; then
  echo "⚠  콘솔 앱이 실행 중이 아닙니다. 먼저 pnpm dev 로 띄우세요."
  exit 1
fi

mkdir -p "$OUT"

ax() {
  osascript -e "tell application \"System Events\" to tell process \"IdaeriConsole\" to $1"
}

# 캡처하려고 남의 창을 바꿔놓고 가지 않는다 — 원래 크기를 기억했다가 끝에 되돌린다.
ORIGINAL_SIZE=$(ax 'get size of window 1' | tr -d ' ')
restore() {
  ax "set size of window 1 to {${ORIGINAL_SIZE}}" >/dev/null 2>&1 || true
}
trap restore EXIT

ax "set size of window 1 to {$WIDTH, $HEIGHT}" >/dev/null
ax 'set frontmost to true' >/dev/null
sleep 1

capture() {  # <탭 라디오 번호> <파일명>
  ax "click radio button $1 of radio group 1 of group 1 of window 1" >/dev/null
  sleep 2
  local position size x y w h
  position=$(ax 'get position of window 1' | tr -d ' ')
  size=$(ax 'get size of window 1' | tr -d ' ')
  x=${position%,*}
  y=${position#*,}
  w=${size%,*}
  h=${size#*,}
  screencapture -x -R"$x,$y,$w,$h" "$OUT/$2.png"
  echo "  $2.png  (${w}x${h} @ ${x},${y})"
}

echo "▶ $OUT"
capture 1 dashboard
capture 2 office
echo "완료 — 대조: open $ROOT/docs/console-screens/"
