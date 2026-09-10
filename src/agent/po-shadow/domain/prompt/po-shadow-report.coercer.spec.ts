import { isPoShadowReportShape } from './po-shadow.shape';
import {
  coerceToPoShadowReport,
  collectStoredFactIds,
} from './po-shadow-report.coercer';

// 원장에 실제로 저장되는 형태 — quiet 회차는 quiet=true 이고 두 배열이 코드로 채워진다.
const storedQuietReport = {
  schemaVersion: 2,
  quiet: true,
  headline: '계획대로 진행 중',
  findings: [],
  purposeConflict: null,
  factSummary: ['#264 업로드 차단 — 리뷰 0건'],
  droppedFindingCount: 0,
  degradedSources: ['Slack 멘션'],
};

const storedFindingReport = {
  schemaVersion: 2,
  quiet: false,
  headline: '#264 부터',
  findings: [
    { factIds: ['stalled:acme/app#264'], point: 'p', suggestion: 's' },
    { factIds: ['unplanned:acme/app#52'], point: 'p', suggestion: 's' },
  ],
  purposeConflict: null,
  factSummary: ['#264 — 리뷰 0건'],
  droppedFindingCount: 1,
  degradedSources: [],
};

describe('coerceToPoShadowReport', () => {
  it('기존 모델 출력 가드는 저장분을 거부한다 — 재사용하면 회수가 영구히 0건이 된다', () => {
    expect(isPoShadowReportShape(storedQuietReport)).toBe(false);
    expect(isPoShadowReportShape(storedFindingReport)).toBe(false);
  });

  it('저장된 실제 형태를 해석한다', () => {
    expect(coerceToPoShadowReport(storedQuietReport)).not.toBeNull();
    expect(coerceToPoShadowReport(storedFindingReport)).not.toBeNull();
  });

  it('findings 가 없거나 형태가 다르면 null 을 돌려준다', () => {
    expect(coerceToPoShadowReport(null)).toBeNull();
    expect(coerceToPoShadowReport({ headline: 'x' })).toBeNull();
    expect(coerceToPoShadowReport({ findings: [{ point: 'p' }] })).toBeNull();
  });

  it('저장분에서 factId 를 모은다', () => {
    expect(collectStoredFactIds(storedFindingReport)).toEqual([
      'stalled:acme/app#264',
      'unplanned:acme/app#52',
    ]);
    expect(collectStoredFactIds(storedQuietReport)).toEqual([]);
    // 해석 실패는 null — 빈 배열로 뭉개면 '지적 없던 회차' 와 구별되지 않는다.
    expect(collectStoredFactIds({ broken: true })).toBeNull();
  });
});
