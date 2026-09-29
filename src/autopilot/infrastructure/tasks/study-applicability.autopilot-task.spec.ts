import { ConfigService } from '@nestjs/config';

import { JudgeStudyApplicabilityUsecase } from '../../../study-brief-cron/application/judge-study-applicability.usecase';
import { ApplicabilityJudgement } from '../../../study-brief-cron/domain/study-applicability.type';
import { StudyApplicabilityAutopilotTask } from './study-applicability.autopilot-task';

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

const setup = (
  result: unknown,
  repo: string | undefined = 'JSL107/personal_agents',
) => {
  const judge = {
    execute: jest.fn().mockResolvedValue(result),
  } as unknown as JudgeStudyApplicabilityUsecase;
  const config = {
    get: jest.fn().mockReturnValue(repo),
  } as unknown as ConfigService;
  return new StudyApplicabilityAutopilotTask(judge, config);
};
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
    expect(result.preview).toMatchObject({
      kind: 'STUDY_APPLY_ISSUE',
      ttlMs: 7 * 24 * 60 * 60 * 1000,
      payload: { studyBriefId: 5, repo: 'JSL107/personal_agents' },
    });
    expect(result.preview?.previewText).not.toContain('<!channel>');
    expect(result.summaryText).toContain('Hooks');
  });

  it('레포 env 가 없으면 APPLY 여도 카드 없이 요약만', async () => {
    const result = await setup(judged('APPLY'), '').run(context);
    expect(result.preview).toBeUndefined();
    expect(result.skip).toBe(false);
  });

  it('레포 env 가 owner/repo 형식이 아니면 카드를 만들지 않는다', async () => {
    const result = await setup(judged('APPLY'), 'not a repo').run(context);
    expect(result.preview).toBeUndefined();
    expect(result.summaryText).toContain('owner/repo 형식이 아님');
  });

  it('조건부 저장이 거부된 회차는 카드를 만들지 않는다', async () => {
    await expect(setup(judged('APPLY', false)).run(context)).resolves.toEqual({
      skip: true,
    });
  });
});
