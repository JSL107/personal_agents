import {
  auroc,
  CalibrationItem,
  clusteredBootstrapAuroc,
  seededRandom,
  thresholdTable,
} from './gate-calibration';

const item = (
  cluster: string,
  score: number,
  label: boolean,
): CalibrationItem => ({ cluster, score, label });

describe('gate-calibration', () => {
  describe('auroc', () => {
    it('양성이 모두 음성보다 높으면 1, 모두 낮으면 0', () => {
      expect(auroc([item('a', 0.9, true), item('b', 0.1, false)])).toBe(1);
      expect(auroc([item('a', 0.1, true), item('b', 0.9, false)])).toBe(0);
    });

    it('동점은 0.5 로 센다 — 상수 점수(legacy 가 전부 올린 표본)는 정의상 0.5', () => {
      expect(
        auroc([item('a', 1, true), item('b', 1, false), item('c', 1, false)]),
      ).toBe(0.5);
    });

    it('한쪽 라벨이 없으면 null', () => {
      expect(auroc([item('a', 0.9, true)])).toBeNull();
      expect(auroc([])).toBeNull();
    });
  });

  describe('clusteredBootstrapAuroc', () => {
    const items = [
      item('pr-1', 0.9, true),
      item('pr-1', 0.8, true),
      item('pr-2', 0.7, true),
      item('pr-3', 0.4, false),
      item('pr-4', 0.6, false),
      item('pr-5', 0.2, false),
      item('pr-5', 0.3, false),
    ];

    it('같은 seed 면 같은 구간을 낸다', () => {
      const first = clusteredBootstrapAuroc(items, 500, seededRandom(7));
      const second = clusteredBootstrapAuroc(items, 500, seededRandom(7));
      expect(first).toEqual(second);
    });

    it('구간이 점추정을 감싼다', () => {
      const point = auroc(items) as number;
      const interval = clusteredBootstrapAuroc(items, 500, seededRandom(7));
      expect(interval).not.toBeNull();
      expect(interval!.low).toBeLessThanOrEqual(point);
      expect(interval!.high).toBeGreaterThanOrEqual(point);
    });

    it('정의되지 않는 표본이면 null', () => {
      expect(
        clusteredBootstrapAuroc([item('a', 0.5, true)], 100, seededRandom(1)),
      ).toBeNull();
    });
  });

  describe('thresholdTable', () => {
    it('문턱 이상은 남기고 미만 음성은 거른 것으로 센다', () => {
      const rows = thresholdTable(
        [
          item('a', 0.9, true),
          item('b', 0.4, true),
          item('c', 0.5, false),
          item('d', 0.2, false),
        ],
        [0.3, 0.5],
      );
      expect(rows).toEqual([
        {
          threshold: 0.3,
          keptPositive: 2,
          totalPositive: 2,
          filteredNegative: 1,
          totalNegative: 2,
        },
        {
          threshold: 0.5,
          keptPositive: 1,
          totalPositive: 2,
          filteredNegative: 1,
          totalNegative: 2,
        },
      ]);
    });
  });
});
