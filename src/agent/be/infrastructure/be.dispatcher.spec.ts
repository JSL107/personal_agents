import { HumanizeService } from '../../../humanize/application/humanize.service';
import { ConversationContext } from '../../../router/domain/conversation-context.type';
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
  const dispatcher = new BeDispatcher(generateBackendPlan, {
    humanize: jest
      .fn()
      .mockImplementation(async (fields: Record<string, string>) =>
        Object.fromEntries(
          Object.entries(fields).map(([key, value]) => [key, `${value}_H`]),
        ),
      ),
  } as unknown as HumanizeService);
  return { dispatcher, generateBackendPlan };
};

describe('BeDispatcher', () => {
  it('plan 을 윤문해 formattedText 로 내보내되 output 원본은 건드리지 않는다', async () => {
    const { dispatcher } = buildDispatcher();

    const outcome = await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '결제 검증 API 추가',
    });

    expect(outcome.agentRunId).toBe(42);
    expect(outcome.formattedText).toContain(
      '기존 /payments 하위에 POST /verify 신설_H',
    );
    expect(outcome.output).toBe(validPlan);
    expect((outcome.output as BackendPlan).context).not.toContain('_H');
  });

  it('conversationContext 가 있으면 generateBackendPlan.execute 에 그대로 전달', async () => {
    const { dispatcher, generateBackendPlan } = buildDispatcher();
    const conversationContext: ConversationContext = {
      userInstruction: '보안 이슈 먼저 처리해줘',
    };

    await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '결제 검증 API 추가',
      conversationContext,
    });

    expect(generateBackendPlan.execute).toHaveBeenCalledWith(
      expect.objectContaining({ conversationContext }),
    );
  });

  it('conversationContext 없으면 execute 에 conversationContext 키 미포함 (기존 동작 회귀 없음)', async () => {
    const { dispatcher, generateBackendPlan } = buildDispatcher();

    await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '결제 검증 API 추가',
    });

    const callArg = generateBackendPlan.execute.mock.calls[0][0];
    expect(callArg).not.toHaveProperty('conversationContext');
  });
});
