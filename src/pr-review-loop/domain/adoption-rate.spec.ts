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
    const [summary] = summarizeAdoption([
      row('CORRECTNESS', 'ACKED', 6),
      row('CORRECTNESS', 'FIXED', 2),
      row('CORRECTNESS', 'REJECTED', 2),
      row('CORRECTNESS', 'OPEN', 99),
      row('CORRECTNESS', 'STALE', 99),
      row('CORRECTNESS', 'SUPPRESSED', 99),
      row('CORRECTNESS', 'RESOLVED', 99),
    ]);

    expect(summary.adopted).toBe(8);
    expect(summary.rejected).toBe(2);
    expect(summary.total).toBe(10);
  });

  it('표본이 충분하면 채택률을 정수 퍼센트로 낸다', () => {
    const [summary] = summarizeAdoption([
      row('TEST', 'ACKED', 14),
      row('TEST', 'FIXED', 2),
      row('TEST', 'REJECTED', 1),
    ]);

    // 16/17 = 94.1% → 94
    expect(summary.ratePercent).toBe(94);
  });

  it('표본이 미달이면 채택률 대신 null 을 낸다', () => {
    const [summary] = summarizeAdoption([
      row('RELIABILITY', 'ACKED', 4),
      row('RELIABILITY', 'REJECTED', 3),
    ]);

    expect(summary.total).toBe(7);
    expect(summary.ratePercent).toBeNull();
  });

  it('분모가 0 인 카테고리는 결과에서 뺀다', () => {
    const summaries = summarizeAdoption([
      row('SECURITY', 'OPEN', 5),
      row('SECURITY', 'STALE', 3),
      enoughAcked('TEST'),
    ]);

    expect(summaries.map(({ category }) => category)).toEqual(['TEST']);
  });

  it('분모가 큰 카테고리부터, 동률이면 이름 순으로 정렬한다', () => {
    const summaries = summarizeAdoption([
      enoughAcked('TEST'),
      row('CORRECTNESS', 'ACKED', 20),
      enoughAcked('RELIABILITY'),
    ]);

    expect(summaries.map(({ category }) => category)).toEqual([
      'CORRECTNESS',
      'RELIABILITY',
      'TEST',
    ]);
  });

  it('집계할 행이 없으면 빈 배열을 낸다', () => {
    expect(summarizeAdoption([])).toEqual([]);
  });
});
