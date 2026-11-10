// 카드 모음 격자 배치 — 칸 크기만 받아 캔버스 크기와 칸 좌표를 계산한다(그리기는 infrastructure 렌더러).
// 휴대폰 DM 폭에서 카드가 너무 작아지지 않게 4칸으로 둔다.
export const CARD_GRID_COLUMNS = 4;

export interface CardCellSize {
  cellWidth: number;
  cellHeight: number;
  // 칸 아래 날짜 글자 자리.
  labelHeight: number;
  gap: number;
}

export interface CardGridInput extends CardCellSize {
  count: number;
}

export interface CardCellPosition {
  left: number;
  top: number;
}

export interface CardGridLayout {
  columns: number;
  rows: number;
  width: number;
  height: number;
  cells: CardCellPosition[];
}

export const cardGridLayoutOf = ({
  count,
  cellWidth,
  cellHeight,
  labelHeight,
  gap,
}: CardGridInput): CardGridLayout => {
  const columns = Math.min(count, CARD_GRID_COLUMNS);
  const rows = Math.ceil(count / CARD_GRID_COLUMNS);
  // 한 칸이 차지하는 가로·세로 — 카드와 그 아래 날짜, 다음 칸까지의 여백을 더한 값.
  const columnSpan = cellWidth + gap;
  const rowSpan = cellHeight + labelHeight + gap;
  const cells = Array.from({ length: count }, (_, index) => ({
    left: gap + (index % CARD_GRID_COLUMNS) * columnSpan,
    top: gap + Math.floor(index / CARD_GRID_COLUMNS) * rowSpan,
  }));
  const layout: CardGridLayout = {
    columns,
    rows,
    width: columns * columnSpan + gap,
    height: rows * rowSpan + gap,
    cells,
  };
  return layout;
};
