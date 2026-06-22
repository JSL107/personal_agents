import { formatRunRetro } from './run-retro.formatter';

describe('formatRunRetro', () => {
  it('건수 내림차순 + 실패율% + 평균초 + 합계', () => {
    const text = formatRunRetro(
      [
        {
          agentType: 'BE',
          total: 5,
          failed: 0,
          failRate: 0,
          avgDurationMs: 31200,
        },
        {
          agentType: 'PM',
          total: 10,
          failed: 1,
          failRate: 0.1,
          avgDurationMs: 1200,
        },
      ],
      '2026-06-22',
    );

    const pmIdx = text.indexOf('PM');
    const beIdx = text.indexOf('BE');
    expect(pmIdx).toBeGreaterThan(-1);
    expect(pmIdx).toBeLessThan(beIdx); // PM(10) 이 BE(5) 보다 위
    expect(text).toContain('PM: 10건 · 실패 1 (10%) · 평균 1.2s');
    expect(text).toContain('총 15건 · 전체 실패율 7%'); // 1/15 ≈ 6.7 → 7
  });

  it('빈 통계도 합계 0 으로 안전하게 렌더', () => {
    const text = formatRunRetro([], '2026-06-22');
    expect(text).toContain('총 0건 · 전체 실패율 0%');
  });
});
