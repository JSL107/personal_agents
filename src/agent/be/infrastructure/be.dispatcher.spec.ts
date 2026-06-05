import { ConfigService } from '@nestjs/config';

import { CreatePreviewUsecase } from '../../../preview-gate/application/create-preview.usecase';
import {
  PREVIEW_KIND,
  PREVIEW_STATUS,
} from '../../../preview-gate/domain/preview-action.type';
import { GenerateBackendPlanUsecase } from '../application/generate-backend-plan.usecase';
import { BackendPlan } from '../domain/be-agent.type';
import { BeDispatcher } from './be.dispatcher';

const validPlan: BackendPlan = {
  subject: '결제 검증 API 추가',
  context: '기존 /payments 하위에 POST /verify 신설',
  implementationChecklist: [
    {
      title: 'DB schema 추가',
      description: 'PaymentVerification 테이블',
      dependsOn: [],
    },
  ],
  apiDesign: [
    {
      method: 'POST',
      path: '/payments/verify',
      request: '{ orderId, pgToken }',
      response: '{ status }',
      notes: 'JWT 필수',
    },
  ],
  risks: ['pg 재시도 중복 호출'],
  testPoints: ['정상 → VERIFIED'],
  estimatedHours: 6,
  reasoning: 'DB → domain → handler 순',
};

const buildDispatcher = (overrides?: {
  generateBackendPlan?: jest.Mocked<GenerateBackendPlanUsecase>;
  createPreviewUsecase?: jest.Mocked<CreatePreviewUsecase>;
  configGet?: jest.Mock;
}) => {
  const generateBackendPlan =
    overrides?.generateBackendPlan ??
    ({
      execute: jest.fn().mockResolvedValue({
        result: validPlan,
        modelUsed: 'claude-cli',
        agentRunId: 42,
      }),
    } as unknown as jest.Mocked<GenerateBackendPlanUsecase>);
  const createPreviewUsecase =
    overrides?.createPreviewUsecase ??
    ({
      execute: jest.fn().mockResolvedValue({
        id: 'preview-id-1',
        slackUserId: 'U1',
        kind: PREVIEW_KIND.BE_SANDBOX_APPLY,
        payload: {},
        status: PREVIEW_STATUS.PENDING,
        previewText: '',
        responseUrl: null,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        createdAt: new Date(),
        appliedAt: null,
        cancelledAt: null,
      }),
    } as unknown as jest.Mocked<CreatePreviewUsecase>);
  const configGet =
    overrides?.configGet ?? jest.fn().mockReturnValue(undefined);
  const dispatcher = new BeDispatcher(
    generateBackendPlan,
    createPreviewUsecase,
    { get: configGet } as unknown as ConfigService,
  );
  return { dispatcher, generateBackendPlan, createPreviewUsecase, configGet };
};

describe('BeDispatcher', () => {
  it('BE_AUTONOMOUS_FROM_PLAN 미설정 → preview 생성 X, plan 만 반환', async () => {
    const { dispatcher, createPreviewUsecase } = buildDispatcher();

    const outcome = await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '결제 검증 API 추가',
    });

    expect(outcome.agentRunId).toBe(42);
    expect(createPreviewUsecase.execute).not.toHaveBeenCalled();
    expect(outcome.formattedText).not.toContain('자동 개발 진행');
  });

  it('BE_AUTONOMOUS_FROM_PLAN=true → BE_SANDBOX_APPLY preview 자동 생성 + Y/N 안내 부착', async () => {
    const { dispatcher, createPreviewUsecase, configGet } = buildDispatcher();
    configGet.mockImplementation((key: string) => {
      if (key === 'BE_AUTONOMOUS_FROM_PLAN') {
        return 'true';
      }
      if (key === 'BE_SANDBOX_DEFAULT_REPO_LABEL') {
        return 'JSL107/my-repo';
      }
      if (key === 'BE_SANDBOX_DEFAULT_BASE_BRANCH') {
        return 'develop';
      }
      return undefined;
    });

    const outcome = await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '결제 검증 API 추가',
    });

    expect(createPreviewUsecase.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        slackUserId: 'U1',
        kind: PREVIEW_KIND.BE_SANDBOX_APPLY,
        payload: expect.objectContaining({
          repoLabel: 'JSL107/my-repo',
          baseBranch: 'develop',
          planText: expect.stringContaining('결제 검증 API 추가'),
        }),
        ttlMs: 30 * 60 * 1000,
      }),
    );
    expect(outcome.formattedText).toContain('자동 개발 진행');
    expect(outcome.formattedText).toContain('JSL107/my-repo');
    expect(outcome.formattedText).toContain('develop');
  });

  it('default — repo label = JSL107/personal_agents, base = main', async () => {
    const { dispatcher, createPreviewUsecase, configGet } = buildDispatcher();
    configGet.mockImplementation((key: string) =>
      key === 'BE_AUTONOMOUS_FROM_PLAN' ? 'true' : undefined,
    );

    await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '결제 API',
    });

    expect(createPreviewUsecase.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          repoLabel: 'JSL107/personal_agents',
          baseBranch: 'main',
        }),
      }),
    );
  });

  it('preview 생성 실패는 graceful — plan 정상 반환 + chain 안내 X', async () => {
    const createPreviewUsecase = {
      execute: jest.fn().mockRejectedValue(new Error('DB down')),
    } as unknown as jest.Mocked<CreatePreviewUsecase>;
    const { dispatcher, configGet } = buildDispatcher({
      createPreviewUsecase,
    });
    configGet.mockImplementation((key: string) =>
      key === 'BE_AUTONOMOUS_FROM_PLAN' ? 'true' : undefined,
    );

    const outcome = await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '결제 API',
    });

    expect(outcome.agentRunId).toBe(42);
    expect(outcome.formattedText).not.toContain('자동 개발 진행');
  });

  it('planText 안 implementationChecklist + apiDesign + risks + testPoints 직렬화', async () => {
    const { dispatcher, createPreviewUsecase, configGet } = buildDispatcher();
    configGet.mockImplementation((key: string) =>
      key === 'BE_AUTONOMOUS_FROM_PLAN' ? 'true' : undefined,
    );

    await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '결제 API',
    });

    const planText = (
      createPreviewUsecase.execute.mock.calls[0][0].payload as {
        planText: string;
      }
    ).planText;
    expect(planText).toContain('[Implementation Checklist]');
    expect(planText).toContain('DB schema 추가');
    expect(planText).toContain('[API Design]');
    expect(planText).toContain('POST /payments/verify');
    expect(planText).toContain('[Risks]');
    expect(planText).toContain('pg 재시도');
    expect(planText).toContain('[Test Points]');
    expect(planText).toContain('정상 → VERIFIED');
  });
});
