import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import {
  AgentType,
  CompletionResponse,
  ModelProviderName,
} from '../../../model-router/domain/model-router.type';
import { IssueLabelInference } from '../domain/issue-labeler.type';
import { IssueLabelerErrorCode } from '../domain/issue-labeler-error-code.enum';
import { InferIssueLabelsUsecase } from './infer-issue-labels.usecase';

describe('InferIssueLabelsUsecase', () => {
  const validInference: IssueLabelInference = {
    labels: ['bug', 'priority:high'],
    reasoning: 'Stack trace + 매일 영향 — 명백한 버그 + 우선순위 높음.',
  };

  let modelRouter: { route: jest.Mock };
  let agentRunServiceExecute: jest.Mock;
  let usecase: InferIssueLabelsUsecase;

  beforeEach(() => {
    modelRouter = { route: jest.fn() };
    agentRunServiceExecute = jest.fn(async (input) => {
      const execution = await input.run({ agentRunId: 11 });
      return {
        result: execution.result,
        modelUsed: execution.modelUsed,
        agentRunId: 11,
      };
    });
    usecase = new InferIssueLabelsUsecase(
      modelRouter as unknown as ModelRouterUsecase,
      { execute: agentRunServiceExecute } as unknown as AgentRunService,
    );

    modelRouter.route.mockResolvedValue({
      text: JSON.stringify(validInference),
      modelUsed: 'claude-cli',
      provider: ModelProviderName.CLAUDE,
    } satisfies CompletionResponse);
  });

  const baseInput = {
    repo: 'foo/bar',
    issueNumber: 42,
    title: 'crash on login',
    body: 'reproduces on staging',
    availableLabels: [
      { name: 'bug', description: '버그 보고서' },
      { name: 'priority:high', description: '긴급 처리 필요' },
      { name: 'docs' },
    ],
  };

  it('title 이 비어 있으면 EMPTY_INPUT 예외', async () => {
    await expect(
      usecase.execute({ ...baseInput, title: '   ' }),
    ).rejects.toMatchObject({
      issueLabelerErrorCode: IssueLabelerErrorCode.EMPTY_INPUT,
    });
    expect(modelRouter.route).not.toHaveBeenCalled();
  });

  it('availableLabels 가 빈 배열이면 NO_REPO_LABELS 예외', async () => {
    await expect(
      usecase.execute({ ...baseInput, availableLabels: [] }),
    ).rejects.toMatchObject({
      issueLabelerErrorCode: IssueLabelerErrorCode.NO_REPO_LABELS,
    });
    expect(modelRouter.route).not.toHaveBeenCalled();
  });

  it('AgentRunService 에 ISSUE_LABELER + WEBHOOK_ISSUE_AUTO_LABEL 전달', async () => {
    await usecase.execute(baseInput);
    const call = agentRunServiceExecute.mock.calls[0][0];
    expect(call.agentType).toBe(AgentType.ISSUE_LABELER);
    expect(call.triggerType).toBe('WEBHOOK_ISSUE_AUTO_LABEL');
    expect(call.evidence).toEqual([
      expect.objectContaining({
        sourceType: 'GITHUB_ISSUE_OPENED',
        sourceId: 'foo/bar#42',
      }),
    ]);
  });

  it('LLM 응답을 그대로 반환 (vocab 내 + 5개 이하)', async () => {
    const outcome = await usecase.execute(baseInput);
    expect(outcome.result.labels).toEqual(['bug', 'priority:high']);
    expect(outcome.modelUsed).toBe('claude-cli');
  });

  it('vocab 외 label 은 필터링 — 안전망', async () => {
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify({
        labels: ['bug', 'made-up-label', 'docs'],
        reasoning: 'mixed',
      }),
      modelUsed: 'claude-cli',
      provider: ModelProviderName.CLAUDE,
    });
    const outcome = await usecase.execute(baseInput);
    expect(outcome.result.labels).toEqual(['bug', 'docs']);
  });

  it('중복 label 은 1개로 dedup', async () => {
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify({
        labels: ['bug', 'bug', 'docs'],
        reasoning: 'dup',
      }),
      modelUsed: 'claude-cli',
      provider: ModelProviderName.CLAUDE,
    });
    const outcome = await usecase.execute(baseInput);
    expect(outcome.result.labels).toEqual(['bug', 'docs']);
  });

  it('5개 초과 label 은 cap', async () => {
    const overflow = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'];
    const vocab = overflow.map((name) => ({ name }));
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify({
        labels: overflow,
        reasoning: 'overflow',
      }),
      modelUsed: 'claude-cli',
      provider: ModelProviderName.CLAUDE,
    });
    const outcome = await usecase.execute({
      ...baseInput,
      availableLabels: vocab,
    });
    expect(outcome.result.labels).toHaveLength(5);
    expect(outcome.result.labels).toEqual(['l1', 'l2', 'l3', 'l4', 'l5']);
  });

  it('LLM 이 빈 labels 반환 시 그대로 빈 배열 (caller 가 skip)', async () => {
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify({ labels: [], reasoning: '적합 없음' }),
      modelUsed: 'claude-cli',
      provider: ModelProviderName.CLAUDE,
    });
    const outcome = await usecase.execute(baseInput);
    expect(outcome.result.labels).toEqual([]);
    expect(outcome.result.reasoning).toBe('적합 없음');
  });
});
