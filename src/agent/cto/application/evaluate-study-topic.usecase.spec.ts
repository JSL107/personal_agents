import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  STUDY_CONCEPT_SYSTEM_PROMPT,
  STUDY_TOOL_SYSTEM_PROMPT,
} from '../domain/prompt/study-topic.prompt';
import { EvaluateStudyTopicUsecase } from './evaluate-study-topic.usecase';

describe('EvaluateStudyTopicUsecase', () => {
  const makeUsecase = () => {
    const modelRouter = { route: jest.fn() };
    const agentRunService = {
      execute: jest.fn(async (input) => {
        const execution = await input.run({ agentRunId: 41 });
        return { ...execution, agentRunId: 41 };
      }),
    };
    return {
      usecase: new EvaluateStudyTopicUsecase(
        modelRouter as unknown as ModelRouterUsecase,
        agentRunService as unknown as AgentRunService,
      ),
      modelRouter,
      agentRunService,
    };
  };

  it.each([
    [
      'CONCEPT',
      STUDY_CONCEPT_SYSTEM_PROMPT,
      {
        whyNow: '지금 필요',
        whereItLands: 'src/agent-run/',
        minutes: 20,
      },
    ],
    [
      'TOOL',
      STUDY_TOOL_SYSTEM_PROMPT,
      {
        whatImproves: '검색 개선',
        adoptionCost: '낮음',
        minutes: 10,
      },
    ],
  ] as const)(
    '%s kind에 맞는 systemPrompt를 전달한다',
    async (kind, systemPrompt, modelOutput) => {
      const dependencies = makeUsecase();
      dependencies.modelRouter.route.mockResolvedValue({
        text: JSON.stringify(modelOutput),
        modelUsed: 'codex-cli',
      });

      const outcome = await dependencies.usecase.execute({
        slackUserId: 'U1',
        research: {
          kind,
          topic: 'durable execution',
          sourceUrls: ['https://example.com'],
          reportMd: '긴 조사 전문',
        },
        profileSummary: '백엔드 개발자',
        profileSkills: ['TypeScript(EXPERT)'],
      });

      expect(dependencies.modelRouter.route).toHaveBeenCalledWith({
        agentType: AgentType.CTO_STUDY,
        request: expect.objectContaining({ systemPrompt }),
      });
      const execution = dependencies.agentRunService.execute.mock.calls[0][0];
      expect(execution.triggerType).toBe(TriggerType.STUDY_BRIEF_CRON);
      expect(execution.inputSnapshot).toEqual({
        slackUserId: 'U1',
        kind,
        topic: 'durable execution',
      });
      expect(execution.inputSnapshot).not.toHaveProperty('reportMd');
      expect(execution.evidence).toEqual([
        {
          sourceType: 'HERMES_RESEARCH',
          sourceId: 'durable execution',
          payload: { sourceUrls: ['https://example.com'] },
        },
      ]);
      expect(outcome.result).toMatchObject({ kind });
    },
  );
});
