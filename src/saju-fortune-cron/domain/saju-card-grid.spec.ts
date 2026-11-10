import { CARD_GRID_COLUMNS, cardGridLayoutOf } from './saju-card-grid';

const CELL = { cellWidth: 240, cellHeight: 360, labelHeight: 40, gap: 16 };

describe('cardGridLayoutOf', () => {
  it.each([
    [1, 1, 1],
    [4, 4, 1],
    [5, 4, 2],
    [31, 4, 8],
  ])('%i장 → %i열 %i행', (count, columns, rows) => {
    const layout = cardGridLayoutOf({ count, ...CELL });

    expect(layout.columns).toBe(columns);
    expect(layout.rows).toBe(rows);
    expect(layout.cells).toHaveLength(count);
  });

  it('기본 열 수는 4', () => {
    expect(CARD_GRID_COLUMNS).toBe(4);
  });

  it('캔버스 크기 = 열·행 × (칸 + 여백) + 여백', () => {
    const layout = cardGridLayoutOf({ count: 5, ...CELL });

    expect(layout.width).toBe(4 * (240 + 16) + 16);
    expect(layout.height).toBe(2 * (360 + 40 + 16) + 16);
  });

  it('칸은 왼쪽 위부터 줄 단위로 놓인다', () => {
    const layout = cardGridLayoutOf({ count: 5, ...CELL });

    expect(layout.cells[0]).toEqual({ left: 16, top: 16 });
    expect(layout.cells[3]).toEqual({ left: 16 + 3 * 256, top: 16 });
    expect(layout.cells[4]).toEqual({ left: 16, top: 16 + 416 });
  });
});
