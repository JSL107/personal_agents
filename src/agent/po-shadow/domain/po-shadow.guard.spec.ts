import { PlanRealityFact } from './plan-reality.diff';
import { guardPoShadowReport } from './po-shadow.guard';
import { PoShadowReport } from './po-shadow.type';

const FACTS: PlanRealityFact[] = [
  {
    id: 'stalled:acme/app#264',
    kind: 'PLANNED_STALLED',
    label: '#264 업로드 차단',
    detail: '리뷰 0건 · 마지막 활동 3일 전',
  },
  {
    id: 'failed:CODE_REVIEWER:run-7',
    kind: 'WORKER_FAILED',
    label: 'Code Reviewer 실행 실패',
    detail: 'MODEL_COMPLETION_FAILED',
  },
];

const baseReport = (): PoShadowReport => ({
  schemaVersion: 2,
  quiet: false,
  headline: '#264 업로드 차단부터 해소하세요.',
  findings: [],
  purposeConflict: null,
  factSummary: ['#264 업로드 차단', 'Code Reviewer 실행 실패'],
  droppedFindingCount: 2,
  degradedSources: [],
});

describe('guardPoShadowReport', () => {
  it('존재하지 않는 factId만 인용한 finding을 제거하고 기존 제외 수에 누적한다', () => {
    const report: PoShadowReport = {
      ...baseReport(),
      findings: [
        {
          factIds: ['invented:fact'],
          point: '존재하지 않는 문제입니다.',
          suggestion: '존재하지 않는 일을 처리하세요.',
        },
      ],
    };

    const guarded = guardPoShadowReport(report, FACTS);

    expect(guarded.findings).toEqual([]);
    expect(guarded.droppedFindingCount).toBe(3);
  });

  it('일부만 유효한 factIds는 유효한 ID만 원래 순서대로 남긴다', () => {
    const report: PoShadowReport = {
      ...baseReport(),
      findings: [
        {
          factIds: [
            'failed:CODE_REVIEWER:run-7',
            'invented:first',
            'stalled:acme/app#264',
            'invented:last',
          ],
          point: '실패한 검토와 차단된 PR이 있습니다.',
          suggestion: '검토를 복구한 뒤 PR을 진행하세요.',
        },
      ],
    };

    const guarded = guardPoShadowReport(report, FACTS);

    expect(guarded.findings).toEqual([
      {
        factIds: ['failed:CODE_REVIEWER:run-7', 'stalled:acme/app#264'],
        point: '실패한 검토와 차단된 PR이 있습니다.',
        suggestion: '검토를 복구한 뒤 PR을 진행하세요.',
      },
    ]);
    expect(guarded.droppedFindingCount).toBe(2);
  });

  it('모든 finding이 제거되어도 headline과 factSummary를 포함한 metadata를 보존한다', () => {
    const report: PoShadowReport = {
      ...baseReport(),
      quiet: true,
      headline: '계획대로 진행 중',
      purposeConflict: '1순위보다 실패 복구가 먼저입니다.',
      factSummary: ['정오 사실 1', '정오 사실 2'],
      findings: [
        {
          factIds: [],
          point: '근거가 없습니다.',
          suggestion: '근거 없이 처리하세요.',
        },
        {
          factIds: ['invented:fact'],
          point: '지어낸 문제입니다.',
          suggestion: '지어낸 일을 처리하세요.',
        },
      ],
    };

    const guarded = guardPoShadowReport(report, FACTS);

    expect(guarded).toEqual({
      schemaVersion: 2,
      quiet: true,
      headline: '계획대로 진행 중',
      findings: [],
      purposeConflict: '1순위보다 실패 복구가 먼저입니다.',
      factSummary: ['정오 사실 1', '정오 사실 2'],
      droppedFindingCount: 4,
      degradedSources: [],
    });
  });

  it('모든 factId가 유효하면 report를 변경하지 않는다', () => {
    const report: PoShadowReport = {
      ...baseReport(),
      findings: [
        {
          factIds: ['stalled:acme/app#264', 'failed:CODE_REVIEWER:run-7'],
          point: 'PR 차단과 워커 실패가 함께 있습니다.',
          suggestion: '두 근거를 순서대로 처리하세요.',
        },
      ],
    };

    const guarded = guardPoShadowReport(report, FACTS);

    expect(guarded).toEqual(report);
  });
});
