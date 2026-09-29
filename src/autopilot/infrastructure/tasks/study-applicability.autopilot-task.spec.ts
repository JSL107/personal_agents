import { ConfigService } from '@nestjs/config';

import { PreviewActionRepositoryPort } from '../../../preview-gate/domain/port/preview-action.repository.port';
import { JudgeStudyApplicabilityUsecase } from '../../../study-brief-cron/application/judge-study-applicability.usecase';
import {
  JudgedApplyStudyBrief,
  StudyBriefRepositoryPort,
} from '../../../study-brief-cron/domain/port/study-brief.repository.port';
import { ApplicabilityJudgement } from '../../../study-brief-cron/domain/study-applicability.type';
import {
  MAX_MODEL_JUDGEMENTS_PER_RUN,
  StudyApplicabilityAutopilotTask,
} from './study-applicability.autopilot-task';

const judgement = (
  verdict: ApplicabilityJudgement['verdict'],
): ApplicabilityJudgement => ({
  verdict,
  rawVerdict: verdict,
  reason: 'r',
  citations:
    verdict === 'APPLY'
      ? [
          {
            filePath: 'src/a.ts',
            startLine: 1,
            endLine: 2,
            name: 'a',
            why: '<!channel>',
          },
        ]
      : [],
  droppedCitations: [],
  downgradeReason: null,
  proposal:
    verdict === 'APPLY'
      ? { title: 't', problem: 'p', change: 'c', verify: 'v' }
      : null,
  candidateCount: 1,
});

const setupWith = ({
  result,
  results,
  repo = 'JSL107/personal_agents',
  applied = [],
  cardBriefIds = [],
}: {
  result?: unknown;
  // 회차 안에서 판정을 반복하므로 순서대로 한 번씩 돌려주고, 다 쓰면 "대상 없음" 을 돌려준다.
  results?: unknown[];
  repo?: string;
  applied?: JudgedApplyStudyBrief[];
  cardBriefIds?: number[];
}) => {
  const execute = jest.fn().mockResolvedValue({ status: 'empty' });
  for (const next of results ?? (result === undefined ? [] : [result])) {
    execute.mockResolvedValueOnce(next);
  }
  const findApplyJudgedSince = jest.fn().mockResolvedValue(applied);
  const countByPayloadValue = jest.fn(
    async ({ payloadValue }: { payloadValue: string | number }) =>
      cardBriefIds.includes(Number(payloadValue)) ? 1 : 0,
  );
  const task = new StudyApplicabilityAutopilotTask(
    { execute } as unknown as JudgeStudyApplicabilityUsecase,
    { get: jest.fn().mockReturnValue(repo) } as unknown as ConfigService,
    { findApplyJudgedSince } as unknown as StudyBriefRepositoryPort,
    { countByPayloadValue } as unknown as PreviewActionRepositoryPort,
  );
  return { task, execute, findApplyJudgedSince, countByPayloadValue };
};

const setup = (
  result: unknown,
  repo: string | undefined = 'JSL107/personal_agents',
) => setupWith({ result, repo }).task;
const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-09-30' };
const judged = (verdict: ApplicabilityJudgement['verdict'], saved = true) => ({
  status: 'judged',
  briefId: 5,
  topic: 'Hooks',
  notionUrl: null,
  judgement: judgement(verdict),
  saved,
});

describe('StudyApplicabilityAutopilotTask', () => {
  it('대상이 없으면 skip', async () => {
    await expect(setup({ status: 'empty' }).run(context)).resolves.toEqual({
      skip: true,
    });
  });

  it.each(['REFERENCE', 'NOT_APPLICABLE'] as const)(
    '%s 는 조용히 skip — 카드 없음',
    async (verdict) => {
      await expect(setup(judged(verdict)).run(context)).resolves.toEqual({
        skip: true,
      });
    },
  );

  it('APPLY 면 7일 TTL 카드와 escape 된 본문을 낸다', async () => {
    const result = await setup(judged('APPLY')).run(context);
    expect(result.previews?.[0]).toMatchObject({
      kind: 'STUDY_APPLY_ISSUE',
      ttlMs: 7 * 24 * 60 * 60 * 1000,
      payload: { studyBriefId: 5, repo: 'JSL107/personal_agents' },
    });
    expect(result.previews?.[0]?.previewText).not.toContain('<!channel>');
    expect(result.summaryText).toContain('Hooks');
  });

  it('레포 env 가 없으면 APPLY 여도 카드 없이 요약만', async () => {
    const result = await setup(judged('APPLY'), '').run(context);
    expect(result.previews).toBeUndefined();
    expect(result.skip).toBe(false);
  });

  it('레포 env 가 owner/repo 형식이 아니면 카드를 만들지 않는다', async () => {
    const result = await setup(judged('APPLY'), 'not a repo').run(context);
    expect(result.previews).toBeUndefined();
    expect(result.summaryText).toContain('owner/repo 형식이 아님');
  });

  it('조건부 저장이 거부된 회차는 카드를 만들지 않는다', async () => {
    await expect(setup(judged('APPLY', false)).run(context)).resolves.toEqual({
      skip: true,
    });
  });

  describe('저장됐지만 카드가 안 만들어진 APPLY', () => {
    const pendingBrief: JudgedApplyStudyBrief = {
      id: 3,
      topic: '어제 주제',
      notionUrl: null,
      judgement: judgement('APPLY'),
    };

    it('카드 행이 없으면 저장된 판정으로 카드를 다시 내고, 새 판정도 이어서 한다', async () => {
      const { task, execute, countByPayloadValue } = setupWith({
        result: judged('APPLY'),
        applied: [pendingBrief],
      });
      const result = await task.run(context);
      // 새 판정이 모델을 불러 상한(1)에 닿으면 그 회차는 거기서 멈춘다.
      expect(execute).toHaveBeenCalledTimes(1);
      expect(
        result.previews?.map(
          (preview) =>
            (preview.payload as { studyBriefId: number }).studyBriefId,
        ),
      ).toEqual([3, 5]);
      expect(countByPayloadValue).toHaveBeenCalledWith({
        kind: 'STUDY_APPLY_ISSUE',
        payloadPath: ['studyBriefId'],
        payloadValue: 3,
      });
      expect(result.previews?.[0]).toMatchObject({
        kind: 'STUDY_APPLY_ISSUE',
        payload: { studyBriefId: 3 },
      });
      expect(result.summaryText).toContain('다시 올립니다');
    });

    it('카드 행이 한 번이라도 있으면(상태 무관) 다시 내지 않고 새 판정으로 넘어간다', async () => {
      const { task, execute } = setupWith({
        result: { status: 'empty' },
        applied: [pendingBrief],
        cardBriefIds: [3],
      });
      await expect(task.run(context)).resolves.toEqual({ skip: true });
      expect(execute).toHaveBeenCalledTimes(1);
    });

    it('레포 설정이 없으면 다시 집지 않아 새 브리프 판정을 막지 않는다', async () => {
      const { task, execute, findApplyJudgedSince } = setupWith({
        result: { status: 'empty' },
        repo: '',
        applied: [pendingBrief],
      });
      await task.run(context);
      expect(findApplyJudgedSince).not.toHaveBeenCalled();
      expect(execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('한 회차에 밀린 판정을 따라잡는다', () => {
    const judgedBrief = (
      briefId: number,
      verdict: ApplicabilityJudgement['verdict'],
      viaModel = true,
    ) => ({
      ...judged(verdict),
      briefId,
      judgement: {
        ...judgement(verdict),
        rawVerdict: viaModel ? verdict : null,
      },
    });

    it('모델 없이 끝난 판정 뒤의 APPLY 까지 같은 회차에 처리한다', async () => {
      const { task, execute } = setupWith({
        results: [
          judgedBrief(51, 'NOT_APPLICABLE', false),
          judgedBrief(52, 'APPLY'),
        ],
      });
      const result = await task.run(context);
      // 모델 없이 끝난 51 은 상한에 들지 않고, 모델을 부른 52 에서 상한에 닿아 멈춘다.
      expect(execute).toHaveBeenCalledTimes(2);
      expect(result.previews).toHaveLength(1);
      expect(result.previews?.[0]).toMatchObject({
        payload: { studyBriefId: 52 },
      });
    });

    it(`모델을 부르는 판정은 한 회차에 ${MAX_MODEL_JUDGEMENTS_PER_RUN}건에서 멈춘다`, async () => {
      const { task, execute } = setupWith({
        results: [1, 2, 3, 4].map((id) => judgedBrief(id, 'REFERENCE')),
      });
      await task.run(context);
      expect(execute).toHaveBeenCalledTimes(MAX_MODEL_JUDGEMENTS_PER_RUN);
    });

    it('첫 판정부터 실패하면 그대로 던진다', async () => {
      const { task, execute } = setupWith({});
      execute.mockReset();
      execute.mockRejectedValue(new Error('codex down'));
      await expect(task.run(context)).rejects.toThrow('codex down');
    });

    it('앞의 판정이 끝난 뒤 실패하면 던지지 않고 실패를 적는다', async () => {
      const { task, execute } = setupWith({});
      execute.mockReset();
      // 모델 없이 끝난 판정은 상한에 들지 않아 다음 판정으로 넘어가고, 거기서 실패한다.
      execute
        .mockResolvedValueOnce(judgedBrief(51, 'NOT_APPLICABLE', false))
        .mockRejectedValueOnce(new Error('codex down'));
      const result = await task.run(context);
      expect(result.skip).toBe(false);
      expect(result.summaryText).toContain('1건 실패');
      expect(execute).toHaveBeenCalledTimes(2);
    });
  });
});
