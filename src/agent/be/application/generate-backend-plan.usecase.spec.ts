import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { GithubClientPort } from '../../../github/domain/port/github-client.port';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import {
  AgentType,
  CompletionResponse,
  ModelProviderName,
} from '../../../model-router/domain/model-router.type';
import { BeAgentException } from '../domain/be-agent.exception';
import { BackendPlan } from '../domain/be-agent.type';
import { BeAgentErrorCode } from '../domain/be-agent-error-code.enum';
import { GenerateBackendPlanUsecase } from './generate-backend-plan.usecase';

const validPlan: BackendPlan = {
  subject: '결제 검증 API 추가',
  context:
    '기존 /payments 하위에 POST /verify 를 신설 — 주문 id + pg token 검증',
  implementationChecklist: [
    {
      title: 'DB schema: PaymentVerification 테이블 신설',
      description: 'order_id / pg_token / status / verified_at 컬럼',
      dependsOn: [],
    },
    {
      title: 'PaymentVerifier 도메인 서비스',
      description: 'pg client 호출 + status 전이 규칙',
      dependsOn: ['DB schema: PaymentVerification 테이블 신설'],
    },
    {
      title: 'POST /payments/verify handler',
      description: 'DTO 검증 + service 호출 + 응답 매핑',
      dependsOn: ['PaymentVerifier 도메인 서비스'],
    },
  ],
  apiDesign: [
    {
      method: 'POST',
      path: '/payments/verify',
      request: '{ orderId: string, pgToken: string }',
      response: '{ status: "VERIFIED"|"FAILED", verifiedAt: string }',
      notes: 'JWT 필요. idempotency key 지원.',
    },
  ],
  risks: ['pg 재시도 중 중복 검증 호출 — idempotency 깨지면 중복 승인 위험'],
  testPoints: [
    'happy: 정상 pgToken → VERIFIED',
    'edge: 만료된 pgToken → FAILED 기록 + 409',
    'failure: pg timeout → 재시도 policy 확인',
  ],
  estimatedHours: 6,
  reasoning:
    'DB → domain → handler 순 분해로 의존성 역전. idempotency 는 domain layer 에 두고 handler 는 얇게.',
};

describe('GenerateBackendPlanUsecase', () => {
  let modelRouter: { route: jest.Mock };
  let agentRunServiceExecute: jest.Mock;
  let githubClient: jest.Mocked<GithubClientPort>;
  let usecase: GenerateBackendPlanUsecase;

  beforeEach(() => {
    modelRouter = { route: jest.fn() };
    agentRunServiceExecute = jest.fn(async (input) => {
      const execution = await input.run({ agentRunId: 13 });
      return {
        result: execution.result,
        modelUsed: execution.modelUsed,
        agentRunId: 13,
      };
    });
    githubClient = {
      listMyAssignedTasks: jest.fn(),
      getPullRequest: jest.fn(),
      getPullRequestDiff: jest.fn(),
      addIssueComment: jest.fn(),
    };

    usecase = new GenerateBackendPlanUsecase(
      modelRouter as unknown as ModelRouterUsecase,
      { execute: agentRunServiceExecute } as unknown as AgentRunService,
      githubClient,
    );

    modelRouter.route.mockResolvedValue({
      text: JSON.stringify(validPlan),
      modelUsed: 'claude-cli',
      provider: ModelProviderName.CLAUDE,
    } satisfies CompletionResponse);
  });

  it('subject 비어있으면 EMPTY_SUBJECT 예외', async () => {
    await expect(
      usecase.execute({ subject: '   ', slackUserId: 'U1' }),
    ).rejects.toMatchObject({
      beAgentErrorCode: BeAgentErrorCode.EMPTY_SUBJECT,
    });
    expect(modelRouter.route).not.toHaveBeenCalled();
  });

  it('자유 텍스트 입력이면 GitHub fetch 없이 prompt = subject', async () => {
    await usecase.execute({
      subject: '결제 검증 API 추가 — 주문 id + pg token 검증',
      slackUserId: 'U1',
    });
    expect(githubClient.getPullRequest).not.toHaveBeenCalled();
    expect(modelRouter.route.mock.calls[0][0].request.prompt).toBe(
      '결제 검증 API 추가 — 주문 id + pg token 검증',
    );
  });

  it('PR shorthand (owner/repo#N) 입력이면 GitHub fetch + prompt ground', async () => {
    githubClient.getPullRequest.mockResolvedValue({
      number: 34,
      title: '결제 검증 API',
      repo: 'foo/bar',
      url: 'https://github.com/foo/bar/pull/34',
      body: 'pg token 기반 검증 흐름 도입',
      baseRef: 'main',
      headRef: 'feat/pay-verify',
      authorLogin: 'JSL107',
      changedFiles: [],
      changedFilesTruncated: false,
      changedFilesTotalCount: 0,
      additions: 0,
      deletions: 0,
    });

    await usecase.execute({ subject: 'foo/bar#34', slackUserId: 'U1' });

    expect(githubClient.getPullRequest).toHaveBeenCalledWith({
      repo: 'foo/bar',
      number: 34,
    });
    const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
    expect(promptArg).toContain('[GitHub PR foo/bar#34]');
    expect(promptArg).toContain('Title: 결제 검증 API');
    expect(promptArg).toContain('pg token 기반 검증 흐름 도입');
  });

  it('PR ref 만 입력 + GitHub fetch 실패 시 PR_GROUNDING_REQUIRED 예외 (codex review bha25i79n P2)', async () => {
    githubClient.getPullRequest.mockRejectedValue(
      new Error('GITHUB_TOKEN not set'),
    );

    await expect(
      usecase.execute({
        subject: 'https://github.com/foo/bar/pull/34',
        slackUserId: 'U1',
      }),
    ).rejects.toMatchObject({
      beAgentErrorCode: BeAgentErrorCode.PR_GROUNDING_REQUIRED,
    });
    // 모델 호출 자체가 막혀야 함 — ungrounded plan regression 방지
    expect(modelRouter.route).not.toHaveBeenCalled();
  });

  it('AgentRunService 에 BE / SLACK_COMMAND_PLAN_TASK 전달 + evidence', async () => {
    await usecase.execute({
      subject: '결제 검증 API 추가',
      slackUserId: 'U1',
    });
    const call = agentRunServiceExecute.mock.calls[0][0];
    expect(call.agentType).toBe(AgentType.BE);
    expect(call.triggerType).toBe('SLACK_COMMAND_PLAN_TASK');
    expect(call.evidence[0]).toMatchObject({
      sourceType: 'SLACK_COMMAND_PLAN_TASK',
      sourceId: 'U1',
    });
  });

  it('모델 응답이 JSON 스키마에 안 맞으면 INVALID_MODEL_OUTPUT 예외', async () => {
    modelRouter.route.mockResolvedValue({
      text: 'not a plan',
      modelUsed: 'claude-cli',
      provider: ModelProviderName.CLAUDE,
    });
    await expect(
      usecase.execute({ subject: '결제 검증 API', slackUserId: 'U1' }),
    ).rejects.toBeInstanceOf(BeAgentException);
  });

  it('apiDesign 이 null 인 plan (내부 배치/리팩터링) 도 정상 파싱', async () => {
    const internalPlan: BackendPlan = {
      ...validPlan,
      subject: '크롤러 재시도 정책 리팩터링',
      apiDesign: null,
    };
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify(internalPlan),
      modelUsed: 'claude-cli',
      provider: ModelProviderName.CLAUDE,
    });

    const result = await usecase.execute({
      subject: '크롤러 재시도 정책 리팩터링',
      slackUserId: 'U1',
    });
    expect(result.result.apiDesign).toBeNull();
    expect(result.modelUsed).toBe('claude-cli');
    expect(result.agentRunId).toBe(13);
  });
});
