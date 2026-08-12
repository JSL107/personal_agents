import { formatPriceCollectionFailures } from './price-collection-failure.formatter';

describe('formatPriceCollectionFailures', () => {
  it('실패 사유를 줄별 목록으로 표시한다', () => {
    expect(
      formatPriceCollectionFailures(2, ['005930: timeout', '000660: 503']),
    ).toBe('시세 수집 실패 상세\n- 005930: timeout\n- 000660: 503');
  });

  it('표본보다 전체 실패가 많으면 앞 20건만 표시했음을 밝힌다', () => {
    const failures = Array.from({ length: 20 }, (_, index) => `${index}: 실패`);

    expect(formatPriceCollectionFailures(21, failures)).toContain(
      '실패 21건 중 앞 20건만 표시',
    );
  });

  it('실패 사유가 없으면 null을 반환한다', () => {
    expect(formatPriceCollectionFailures(0, [])).toBeNull();
  });
});
