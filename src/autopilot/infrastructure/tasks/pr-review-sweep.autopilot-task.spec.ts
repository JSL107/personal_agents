import { HarvestReviewSignalsUsecase } from '../../../pr-review-loop/application/harvest-review-signals.usecase';
import { SweepPrReviewsUsecase } from '../../../pr-review-loop/application/sweep-pr-reviews.usecase';
import { PrReviewSweepAutopilotTask } from './pr-review-sweep.autopilot-task';

const CONTEXT = { ownerSlackUserId: 'U123', firedAtKst: '2026-07-31' };

describe('PrReviewSweepAutopilotTask', () => {
  let harvestUsecase: jest.Mocked<Pick<HarvestReviewSignalsUsecase, 'execute'>>;
  let sweepUsecase: jest.Mocked<Pick<SweepPrReviewsUsecase, 'execute'>>;
  let task: PrReviewSweepAutopilotTask;

  beforeEach(() => {
    harvestUsecase = {
      execute: jest.fn().mockResolvedValue({
        acked: 0,
        fixed: 0,
        rejected: 0,
        stale: 0,
        resolved: 0,
        judged: 0,
        skipped: 0,
        contradicted: 0,
        quotaStopped: false,
        adoption: [],
      }),
    };
    sweepUsecase = { execute: jest.fn() };
    task = new PrReviewSweepAutopilotTask(
      harvestUsecase as unknown as HarvestReviewSignalsUsecase,
      sweepUsecase as unknown as SweepPrReviewsUsecase,
    );
  });

  it('id 는 pr-review-sweep', () => {
    expect(task.id).toBe('pr-review-sweep');
  });

  it('결과가 없으면 skip — 15분마다 빈 알림을 보내지 않는다', async () => {
    sweepUsecase.execute.mockResolvedValue({
      results: [],
      quotaStopped: false,
    });

    await expect(task.run(CONTEXT)).resolves.toEqual({ skip: true });
  });

  it('결과가 있으면 요약을 summaryText 로 낸다', async () => {
    sweepUsecase.execute.mockResolvedValue({
      quotaStopped: false,
      results: [
        {
          prRef: 'JSL107/personal_agents#180',
          riskLevel: 'high',
          outcome: {
            inline: 2,
            file: 0,
            issueComment: 0,
            dryRun: 0,
            notPosted: 0,
            dropped: 0,
            duplicate: 0,
          },
        },
      ],
    });

    const result = await task.run(CONTEXT);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('JSL107/personal_agents#180');
    expect(result.summaryText).toContain('인라인 2');
  });

  it('수확을 리뷰 스윕보다 먼저 실행한다', async () => {
    const callOrder: string[] = [];
    harvestUsecase.execute.mockImplementation(async () => {
      callOrder.push('harvest');
      return {
        acked: 0,
        fixed: 0,
        rejected: 0,
        stale: 0,
        resolved: 0,
        judged: 0,
        skipped: 0,
        contradicted: 0,
        quotaStopped: false,
        adoption: [],
      };
    });
    sweepUsecase.execute.mockImplementation(async () => {
      callOrder.push('sweep');
      return { results: [], quotaStopped: false };
    });

    await task.run(CONTEXT);

    expect(callOrder).toEqual(['harvest', 'sweep']);
  });

  it('리뷰 결과가 없어도 수확 결과가 있으면 알림을 만든다', async () => {
    harvestUsecase.execute.mockResolvedValue({
      acked: 2,
      rejected: 1,
      fixed: 1,
      stale: 0,
      resolved: 3,
      judged: 0,
      skipped: 0,
      contradicted: 0,
      quotaStopped: false,
      adoption: [
        {
          category: 'TEST',
          adopted: 16,
          rejected: 1,
          total: 17,
          ratePercent: 94,
          changePercentPoint: 3,
        },
      ],
    });
    sweepUsecase.execute.mockResolvedValue({
      results: [],
      quotaStopped: false,
    });

    const result = await task.run(CONTEXT);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('👍 2');
    expect(result.summaryText).toContain('👎 1');
    // 수확 결과와 함께 누적 채택률도 요약에 실린다.
    expect(result.summaryText).toContain('TEST 94%(17)');
  });

  it('수확 실패는 경고만 남기고 리뷰 스윕을 계속한다', async () => {
    harvestUsecase.execute.mockRejectedValue(new Error('harvest down'));
    sweepUsecase.execute.mockResolvedValue({
      quotaStopped: false,
      results: [
        {
          prRef: 'a/b#1',
          riskLevel: 'low',
          outcome: {
            inline: 1,
            file: 0,
            issueComment: 0,
            dryRun: 0,
            notPosted: 0,
            dropped: 0,
            duplicate: 0,
          },
        },
      ],
    });

    const result = await task.run(CONTEXT);

    expect(result.skip).toBe(false);
    expect(sweepUsecase.execute).toHaveBeenCalledTimes(1);
    expect(result.summaryText).toContain('a/b#1');
  });

  it('판정·미결 카운터만 있으면 상태 전이가 아니므로 알림을 생략한다', async () => {
    harvestUsecase.execute.mockResolvedValue({
      acked: 0,
      fixed: 0,
      rejected: 0,
      stale: 0,
      resolved: 0,
      judged: 2,
      skipped: 1,
      contradicted: 0,
      quotaStopped: false,
      adoption: [],
    });
    sweepUsecase.execute.mockResolvedValue({
      results: [],
      quotaStopped: false,
    });

    await expect(task.run(CONTEXT)).resolves.toEqual({ skip: true });
  });

  it('보류(contradicted)만 있어도 알림을 보낸다 — 사람이 손대야 풀린다', async () => {
    // hasHarvestResult 가 이 카운터를 안 보면 보류만 있는 회차가 통째로 skip 되어
    // 카드가 조용히 OPEN 에 쌓인다(👎 + 수용 답글 모순, 카드 57 사고).
    harvestUsecase.execute.mockResolvedValue({
      acked: 0,
      fixed: 0,
      rejected: 0,
      stale: 0,
      resolved: 0,
      judged: 1,
      skipped: 0,
      contradicted: 1,
      quotaStopped: false,
      adoption: [],
    });
    sweepUsecase.execute.mockResolvedValue({
      results: [],
      quotaStopped: false,
    });

    const result = await task.run(CONTEXT);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('보류 1');
    // 하루 1회 발송 가드(그룹×날짜)는 그날 첫 회차만 통과시킨다 — 뒤 회차에 새로
    // 생긴 보류가 묻히지 않도록 건수를 접미사로 실어 orchestrator 의 가드 키에
    // 반영한다(autopilot-task.port.ts AutopilotTaskResult.guardKeySuffix 참조).
    expect(result.guardKeySuffix).toBe('contradicted-1');
  });

  // 사용자 반응은 카드 게시보다 뒤에 온다. 그날 첫 발송은 보통 게시가 가져가므로, 반응
  // 건수가 키에 없으면 반응 회차는 구조적으로 늘 "이미 발송됨" 으로 막혀 다음 날까지 묻힌다
  // (harvest-review-signals.usecase 의 attachAdoption 주석이 같은 현상을 기록하고 있다).
  it('수확한 반응이 있으면 harvested 건수를 접미사에 싣는다 — 반응 회차가 묻히지 않게', async () => {
    harvestUsecase.execute.mockResolvedValue({
      acked: 1,
      fixed: 0,
      rejected: 0,
      stale: 0,
      resolved: 1,
      judged: 0,
      skipped: 0,
      contradicted: 0,
      quotaStopped: false,
      adoption: [],
    });
    sweepUsecase.execute.mockResolvedValue({
      results: [],
      quotaStopped: false,
    });

    const result = await task.run(CONTEXT);

    expect(result.skip).toBe(false);
    expect(result.guardKeySuffix).toBe('harvested-2');
  });

  it('새로 게시한 카드가 있으면 PR 별 지문을 접미사에 싣는다 — 오후에 달린 지적이 묻히지 않게', async () => {
    sweepUsecase.execute.mockResolvedValue({
      quotaStopped: false,
      results: [
        {
          prRef: 'JSL107/personal_agents#180',
          riskLevel: 'high',
          outcome: {
            inline: 2,
            file: 1,
            issueComment: 0,
            dryRun: 0,
            notPosted: 0,
            dropped: 0,
            duplicate: 0,
          },
        },
      ],
    });

    const result = await task.run(CONTEXT);

    expect(result.skip).toBe(false);
    expect(result.guardKeySuffix).toBe('cards-JSL107/personal_agents#180x3');
  });

  // 총 건수만 실으면 오전 PR A 1 건과 오후 PR B 1 건이 같은 키로 접혀 후자가 막힌다 —
  // 이 변경이 없애려던 바로 그 시나리오다.
  it('건수가 같아도 대상 PR 이 다르면 접미사가 갈린다', async () => {
    const runWith = async (prRef: string): Promise<string | undefined> => {
      sweepUsecase.execute.mockResolvedValue({
        quotaStopped: false,
        results: [
          {
            prRef,
            riskLevel: 'high',
            outcome: {
              inline: 1,
              file: 0,
              issueComment: 0,
              dryRun: 0,
              notPosted: 0,
              dropped: 0,
              duplicate: 0,
            },
          },
        ],
      });
      const outcome = await task.run(CONTEXT);
      return outcome.guardKeySuffix;
    };

    const first = await runWith('JSL107/personal_agents#180');
    const second = await runWith('JSL107/personal_agents#181');

    expect(first).not.toBe(second);
  });

  it('여러 PR 의 지문은 스윕 순서와 무관하게 같은 키가 된다', async () => {
    const buildSweepResult = (prRef: string, inline: number) => ({
      prRef,
      riskLevel: 'high',
      outcome: {
        inline,
        file: 0,
        issueComment: 0,
        dryRun: 0,
        notPosted: 0,
        dropped: 0,
        duplicate: 0,
      },
    });
    const first = buildSweepResult('JSL107/personal_agents#180', 2);
    const second = buildSweepResult('JSL107/personal_agents#181', 1);

    sweepUsecase.execute.mockResolvedValue({
      quotaStopped: false,
      results: [first, second],
    });
    const forward = (await task.run(CONTEXT)).guardKeySuffix;

    sweepUsecase.execute.mockResolvedValue({
      quotaStopped: false,
      results: [second, first],
    });
    const reversed = (await task.run(CONTEXT)).guardKeySuffix;

    expect(reversed).toBe(forward);
  });

  // 🔴 이 회차가 skip 되지 않으면 접미사가 비어 기본 날짜 키로 발송된다. 그날 첫 발송이
  // 접미사 키를 소비했다면 기본 키는 아직 미소비라 그대로 통과해, 새 내용이 없는데도 요약이
  // 한 번 더 나간다(실측 2026-09-11 09:06:15 과 같은 형태).
  it('이미 있는 카드(duplicate)만 나온 회차는 skip 한다 — 기본 날짜 키를 소비하지 않게', async () => {
    sweepUsecase.execute.mockResolvedValue({
      quotaStopped: false,
      results: [
        {
          prRef: 'JSL107/personal_agents#180',
          riskLevel: 'low',
          outcome: {
            inline: 0,
            file: 0,
            issueComment: 0,
            dryRun: 0,
            notPosted: 0,
            dropped: 0,
            duplicate: 5,
          },
        },
      ],
    });

    await expect(task.run(CONTEXT)).resolves.toEqual({ skip: true });
  });

  // 게시 실패(notPosted)·상한 초과(dropped)는 사람이 봐야 하는 신호다. duplicate 와 함께
  // 묶어 skip 하면 그 회차가 통째로 사라져 조용한 실패가 된다.
  it('게시 실패·상한 초과만 있어도 알리고 접미사를 싣는다', async () => {
    sweepUsecase.execute.mockResolvedValue({
      quotaStopped: false,
      results: [
        {
          prRef: 'JSL107/personal_agents#180',
          riskLevel: 'low',
          outcome: {
            inline: 0,
            file: 0,
            issueComment: 0,
            dryRun: 0,
            notPosted: 1,
            dropped: 2,
            duplicate: 5,
          },
        },
      ],
    });

    const result = await task.run(CONTEXT);

    expect(result.skip).toBe(false);
    expect(result.guardKeySuffix).toBe('cards-JSL107/personal_agents#180x3');
  });

  // 불변식: 발송하는 회차는 반드시 접미사를 갖는다. 하나라도 비면 기본 날짜 키가 소비되고,
  // 그 뒤 같은 날 접미사 키를 쓰는 회차와 서로를 막지 못해 중복 발송이 생긴다.
  it('skip 하지 않는 모든 회차는 접미사를 갖는다', async () => {
    const cases = [
      { harvest: { acked: 1 }, sweep: { results: [], quotaStopped: false } },
      {
        harvest: { contradicted: 1 },
        sweep: { results: [], quotaStopped: false },
      },
      { harvest: {}, sweep: { results: [], quotaStopped: true } },
      {
        harvest: {},
        sweep: {
          quotaStopped: false,
          results: [
            {
              prRef: 'JSL107/personal_agents#180',
              riskLevel: 'high',
              outcome: {
                inline: 1,
                file: 0,
                issueComment: 0,
                dryRun: 0,
                notPosted: 0,
                dropped: 0,
                duplicate: 0,
              },
            },
          ],
        },
      },
    ];

    for (const testCase of cases) {
      harvestUsecase.execute.mockResolvedValue({
        acked: 0,
        fixed: 0,
        rejected: 0,
        stale: 0,
        resolved: 0,
        judged: 0,
        skipped: 0,
        contradicted: 0,
        quotaStopped: false,
        adoption: [],
        ...testCase.harvest,
      });
      sweepUsecase.execute.mockResolvedValue(testCase.sweep);

      const result = await task.run(CONTEXT);

      expect(result.skip).toBe(false);
      expect(result.guardKeySuffix).toBeDefined();
    }
  });
  // 실측(2026-08-07~08): 쿼터 소진으로 26 회차가 연속 실패하는 동안 산출물이 0 이라
  // 전부 skip 으로 빠져, 30 시간짜리 중단이 Slack 에 한 번도 나타나지 않았다.
  it('수확이 쿼터로 끊기면 산출물이 0 이어도 알린다', async () => {
    harvestUsecase.execute.mockResolvedValue({
      acked: 0,
      fixed: 0,
      rejected: 0,
      stale: 0,
      resolved: 0,
      judged: 0,
      skipped: 7,
      contradicted: 0,
      quotaStopped: true,
      adoption: [],
    });
    sweepUsecase.execute.mockResolvedValue({
      results: [],
      quotaStopped: false,
    });

    const result = await task.run(CONTEXT);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('쿼터 소진');
    // skip 을 푸는 것만으로는 부족하다 — 보류가 0 인 쿼터 회차는 가드 키가 그룹×날짜
    // 그대로라, 그날 앞 회차(카드 게시 등)가 이미 소비했으면 "이미 발송됨" 으로 막힌다
    // (autopilot.orchestrator.ts buildGuardKey).
    expect(result.guardKeySuffix).toBe('quota-stopped');
  });

  it('리뷰 스윕이 쿼터로 끊기면 수확이 조용해도 알린다', async () => {
    sweepUsecase.execute.mockResolvedValue({
      results: [],
      quotaStopped: true,
    });

    const result = await task.run(CONTEXT);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('쿼터 소진');
    expect(result.guardKeySuffix).toBe('quota-stopped');
  });

  it('보류와 쿼터 중단이 겹치면 접미사에 둘 다 싣는다', async () => {
    // 한 task 는 접미사를 하나만 낼 수 있다(orchestrator 가 task 당 1개 수집). 한쪽만
    // 실으면 다른 쪽의 상태 변화가 키에 안 보여, 보류 건수가 그대로인 채 쿼터가 끊긴
    // 회차(혹은 그 반대)가 앞 회차 키와 겹쳐 막힌다.
    harvestUsecase.execute.mockResolvedValue({
      acked: 0,
      fixed: 0,
      rejected: 0,
      stale: 0,
      resolved: 0,
      judged: 1,
      skipped: 4,
      contradicted: 2,
      quotaStopped: true,
      adoption: [],
    });
    sweepUsecase.execute.mockResolvedValue({
      results: [],
      quotaStopped: false,
    });

    const result = await task.run(CONTEXT);

    expect(result.guardKeySuffix).toBe('contradicted-2+quota-stopped');
  });
});
