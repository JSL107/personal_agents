import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { wrapUntrustedInput } from '../../common/llm/untrusted-input.util';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import {
  AgentType,
  ModelProviderName,
} from '../../model-router/domain/model-router.type';
import { IDEA_TRIAGE_OUTPUT_SCHEMA } from '../domain/idea-triage.schema';
import { IDEA_TRIAGE_SYSTEM_PROMPT } from '../domain/prompt/idea-triage-system.prompt';
import { JudgeIdeaUsecase } from './judge-idea.usecase';

const MODEL_OUTPUT = {
  verdict: 'BUILD',
  reason: '사용자가 반복 작업을 줄일 수 있다. 구현 범위가 작다.',
  counterpoint: '지금은 실제 수요를 모른다.',
  scheduleTitle: '아이디어를 분류한다',
  effort: 'S',
};

describe('JudgeIdeaUsecase', () => {
  it('외부 입력을 감싸고 4000자로 제한해 구조화 판정을 원장에 기록한다', async () => {
    const route = jest.fn().mockResolvedValue({
      text: JSON.stringify(MODEL_OUTPUT),
      modelUsed: 'codex',
      provider: ModelProviderName.CHATGPT,
    });
    const recordModelResponse = jest.fn().mockResolvedValue(undefined);
    const execute = jest.fn().mockImplementation(async ({ run }) => {
      const execution = await run({ agentRunId: 17, recordModelResponse });
      return { ...execution, agentRunId: 17 };
    });
    const usecase = new JudgeIdeaUsecase(
      { route } as unknown as ModelRouterUsecase,
      { execute } as unknown as AgentRunService,
    );

    const result = await usecase.execute({
      channelId: 'C123',
      messageTs: '123.456',
      ideaText: '가'.repeat(4_100),
    });

    expect(result).toEqual({ judgement: MODEL_OUTPUT, agentRunId: 17 });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: AgentType.IDEA_TRIAGE,
        inputSnapshot: { channelId: 'C123', messageTs: '123.456' },
      }),
    );
    expect(route).toHaveBeenCalledWith({
      agentType: AgentType.IDEA_TRIAGE,
      request: {
        prompt: wrapUntrustedInput('가'.repeat(4_000)),
        systemPrompt: IDEA_TRIAGE_SYSTEM_PROMPT,
        outputSchema: IDEA_TRIAGE_OUTPUT_SCHEMA,
      },
    });
    expect(recordModelResponse).toHaveBeenCalledWith(
      JSON.stringify(MODEL_OUTPUT),
    );
  });
});
