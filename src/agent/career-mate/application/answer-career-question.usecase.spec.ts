import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { FactAnswerUsecase } from '../../../fact-answer/application/fact-answer.usecase';
import { CareerProfileRepositoryPort } from '../domain/port/career-profile.repository.port';
import { AnswerCareerQuestionUsecase } from './answer-career-question.usecase';

const build = (latest: unknown) => {
  const execute = jest.fn(async (input) => {
    const r = await input.run({ agentRunId: 51 });
    return { result: r.result, modelUsed: r.modelUsed, agentRunId: 51 };
  });
  const answer = jest.fn().mockResolvedValue({
    text: '답',
    usedFallback: false,
    modelUsed: 'codex-cli',
  });
  const usecase = new AnswerCareerQuestionUsecase(
    {
      findLatestBySlackUser: jest.fn().mockResolvedValue(latest),
    } as unknown as CareerProfileRepositoryPort,
    { execute } as unknown as AgentRunService,
    { answer } as unknown as FactAnswerUsecase,
  );
  return { usecase, execute, answer };
};

const ask = (usecase: AnswerCareerQuestionUsecase) =>
  usecase.execute({
    slackUserId: 'U1',
    text: '내 이력서 기준으로 백엔드 몇 년차로 보여?',
    priorTurns: [],
    parsedIntent: { action: 'UNKNOWN' },
  });

describe('AnswerCareerQuestionUsecase', () => {
  it('프로필이 없으면 만드는 법을 사실로 넘긴다', async () => {
    const { usecase, answer, execute } = build(null);
    await ask(usecase);
    expect(execute.mock.calls[0][0].inputSnapshot).toMatchObject({
      action: 'UNKNOWN',
    });
    expect(answer.mock.calls[0][0].facts).toMatchObject({ hasProfile: false });
    expect(answer.mock.calls[0][0].facts.howToCreate).toContain(
      '프로필 정리해줘',
    );
  });

  it('프로필이 있으면 요약·기술·성과를 넘기고, 경력 연수가 없다는 사실도 함께 넘긴다', async () => {
    const { usecase, answer } = build({
      id: 1,
      agentRunId: 2,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      profileJson: {
        summary: 'NestJS 백엔드',
        skills: [
          {
            name: 'NestJS',
            category: 'BACKEND',
            proficiency: 'ADVANCED',
            evidence: [],
          },
        ],
        accomplishments: [
          {
            title: 'T',
            bullet: 'B',
            star: { situation: '', task: '', action: '', result: '' },
            techTags: ['Prisma'],
            evidence: [],
          },
        ],
        meta: {
          githubLogin: 'JSL107',
          windowStart: '2025-10-01',
          prCount: 120,
        },
      },
    });
    await ask(usecase);
    const facts = answer.mock.calls[0][0].facts;
    expect(facts).toMatchObject({
      hasProfile: true,
      profileCreatedAt: '2026-09-01',
      basedOn: { prCount: 120 },
      skills: [{ name: 'NestJS' }],
    });
    // 모델이 "몇 년차" 를 지어내지 않도록, 그 값이 없다는 사실을 명시한다.
    expect(facts.note).toContain('경력 연수');
  });
});
