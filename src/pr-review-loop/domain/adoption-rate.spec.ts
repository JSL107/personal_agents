import { ADOPTION_MIN_SAMPLE, summarizeAdoption } from './adoption-rate';

const row = (category: string, status: string, count: number) => ({
  category,
  status,
  count,
});

// 표본 미달 카테고리를 만들지 않으려면 분모가 ADOPTION_MIN_SAMPLE 이상이어야 한다.
const enoughAcked = (category: string) =>
  row(category, 'ACKED', ADOPTION_MIN_SAMPLE);

describe('summarizeAdoption', () => {
  it('분모에 ACKED·FIXED·REJECTED 만 넣는다', () => {
    const [summary] = summarizeAdoption(
      [
        row('CORRECTNESS', 'ACKED', 6),
        row('CORRECTNESS', 'FIXED', 2),
        row('CORRECTNESS', 'REJECTED', 2),
        row('CORRECTNESS', 'OPEN', 99),
        row('CORRECTNESS', 'STALE', 99),
        row('CORRECTNESS', 'SUPPRESSED', 99),
        row('CORRECTNESS', 'RESOLVED', 99),
      ],
      [],
    );

    expect(summary.adopted).toBe(8);
    expect(summary.rejected).toBe(2);
    expect(summary.total).toBe(10);
  });

  it('표본이 충분하면 채택률을 정수 퍼센트로 낸다', () => {
    const [summary] = summarizeAdoption(
      [
        row('TEST', 'ACKED', 14),
        row('TEST', 'FIXED', 2),
        row('TEST', 'REJECTED', 1),
      ],
      [],
    );

    // 16/17 = 94.1% → 94
    expect(summary.ratePercent).toBe(94);
  });

  it('표본이 미달이면 채택률 대신 null 을 낸다', () => {
    const [summary] = summarizeAdoption(
      [row('RELIABILITY', 'ACKED', 4), row('RELIABILITY', 'REJECTED', 3)],
      [],
    );

    expect(summary.total).toBe(7);
    expect(summary.ratePercent).toBeNull();
  });

  it('분모가 0 인 카테고리는 결과에서 뺀다', () => {
    const summaries = summarizeAdoption(
      [
        row('SECURITY', 'OPEN', 5),
        row('SECURITY', 'STALE', 3),
        enoughAcked('TEST'),
      ],
      [],
    );

    expect(summaries.map(({ category }) => category)).toEqual(['TEST']);
  });

  it('분모가 큰 카테고리부터, 동률이면 이름 순으로 정렬한다', () => {
    const summaries = summarizeAdoption(
      [
        enoughAcked('TEST'),
        row('CORRECTNESS', 'ACKED', 20),
        enoughAcked('RELIABILITY'),
      ],
      [],
    );

    expect(summaries.map(({ category }) => category)).toEqual([
      'CORRECTNESS',
      'RELIABILITY',
      'TEST',
    ]);
  });

  it('집계할 행이 없으면 빈 배열을 낸다', () => {
    expect(summarizeAdoption([], [])).toEqual([]);
  });

  describe('직전 구간 대비 변화', () => {
    it('두 구간 모두 표본을 채우면 %p 차이를 낸다', () => {
      const [summary] = summarizeAdoption(
        // 최근: 18/20 = 90%
        [row('CORRECTNESS', 'ACKED', 18), row('CORRECTNESS', 'REJECTED', 2)],
        // 직전: 14/20 = 70%
        [row('CORRECTNESS', 'ACKED', 14), row('CORRECTNESS', 'REJECTED', 6)],
      );

      expect(summary.ratePercent).toBe(90);
      expect(summary.changePercentPoint).toBe(20);
    });

    it('나빠진 구간은 음수로 낸다', () => {
      const [summary] = summarizeAdoption(
        [row('TEST', 'ACKED', 12), row('TEST', 'REJECTED', 8)],
        [row('TEST', 'ACKED', 18), row('TEST', 'REJECTED', 2)],
      );

      // 60% - 90%
      expect(summary.changePercentPoint).toBe(-30);
    });

    it('같으면 0 — 변화 없음과 기준선 없음을 구분한다', () => {
      const [summary] = summarizeAdoption(
        [enoughAcked('TEST')],
        [enoughAcked('TEST')],
      );

      expect(summary.changePercentPoint).toBe(0);
    });

    it('직전 구간 표본이 미달이면 변화를 내지 않는다', () => {
      // 기준선이 4건짜리 비율이면 화살표가 추세처럼 보이지만 사실은 잡음이다.
      const [summary] = summarizeAdoption(
        [row('RELIABILITY', 'ACKED', 20)],
        [row('RELIABILITY', 'ACKED', 3), row('RELIABILITY', 'REJECTED', 1)],
      );

      expect(summary.ratePercent).toBe(100);
      expect(summary.changePercentPoint).toBeNull();
    });

    it('직전 구간에 없던 카테고리는 변화가 null 이다', () => {
      const [summary] = summarizeAdoption([enoughAcked('READABILITY')], []);

      expect(summary.changePercentPoint).toBeNull();
    });

    it('최근 구간 표본이 미달이면 변화도 내지 않는다', () => {
      const [summary] = summarizeAdoption(
        [row('ARCHITECTURE', 'ACKED', 3)],
        [enoughAcked('ARCHITECTURE')],
      );

      expect(summary.ratePercent).toBeNull();
      expect(summary.changePercentPoint).toBeNull();
    });

    it('직전 구간에만 있는 카테고리는 결과에 넣지 않는다', () => {
      // 기준선은 비교용일 뿐이다. 최근에 결론이 없으면 지금 말할 것이 없다.
      const summaries = summarizeAdoption(
        [enoughAcked('TEST')],
        [enoughAcked('TEST'), enoughAcked('SECURITY')],
      );

      expect(summaries.map(({ category }) => category)).toEqual(['TEST']);
    });
  });
});
