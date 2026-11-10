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
}: CardCellSize & { count: number }): CardGridLayout => {
  const columns = Math.min(count, CARD_GRID_COLUMNS);
  const rows = Math.ceil(count / CARD_GRID_COLUMNS);
  const stepX = cellWidth + gap;
  const stepY = cellHeight + labelHeight + gap;
  const cells = Array.from({ length: count }, (_, index) => ({
    left: gap + (index % CARD_GRID_COLUMNS) * stepX,
    top: gap + Math.floor(index / CARD_GRID_COLUMNS) * stepY,
  }));
  const layout: CardGridLayout = {
    columns,
    rows,
    width: columns * stepX + gap,
    height: rows * stepY + gap,
    cells,
  };
  return layout;
};
