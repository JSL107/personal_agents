// 캔버스의 백버퍼 크기와 CSS 크기를 정하는 순수 계산.
//
// `live.js` 에서 떼어 낸 이유는 **DOM 없이 검증할 수 있게** 하기 위해서다. 백버퍼와 CSS 크기가
// 서로 다른 축으로 움직이는 경로가 있어(아래) 눈으로는 놓치기 쉽다 — `pnpm check:canvas` 가
// node 로 그 경로를 단정한다.

/**
 * @param {number} logicalWidth  CSS 픽셀 폭
 * @param {number} logicalHeight CSS 픽셀 높이
 * @param {number} pixelRatio    `window.devicePixelRatio`
 * @returns {{cssWidth:number, cssHeight:number, bufferWidth:number, bufferHeight:number}}
 */
export function canvasSizes(logicalWidth, logicalHeight, pixelRatio) {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const cssWidth = Math.round(logicalWidth);
  const cssHeight = Math.round(logicalHeight);
  return {
    cssWidth,
    cssHeight,
    // 백버퍼는 실제 화면 픽셀 수. Retina 에서 이것을 CSS 크기로 두면 그리기 해상도가 절반이라
    // 도트 하나가 두 픽셀로 확대돼 나온다.
    bufferWidth: Math.round(cssWidth * ratio),
    bufferHeight: Math.round(cssHeight * ratio),
  };
}
