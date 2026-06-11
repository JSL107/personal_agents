import { Logger } from '@nestjs/common';

// 하네스는 test/ 아래(빌드 산출물 오염 방지). spec 은 src/ 라 rootDir 수집 대상.
import { buildRouterHarness } from '../../../test/harness/router-harness';
import { AgentType } from '../../model-router/domain/model-router.type';
import { RouterErrorCode } from '../domain/router-error-code.enum';

describe('Router 스모크 replay 하네스', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('전 AgentType 이 dispatcher 로 등록돼 hint 라우팅이 동작한다 (RouterModule 배선 회귀 방지)', async () => {
    const harness = buildRouterHarness();
    for (const agentType of Object.values(AgentType)) {
      const result = await harness.replayHint(agentType, 'x');
      expect(result.workerType).toBe(agentType);
      expect(result.modelUsed).toBe(`mock-${agentType}`);
    }
  });

  it('자연어 휴리스틱 분류 → 올바른 worker 로 dispatch', async () => {
    const harness = buildRouterHarness();

    const pm = await harness.replayText('오늘 plan 짜줘');
    expect(pm.workerType).toBe(AgentType.PM);
    expect(pm.formattedText).toContain('[MOCK PM]');

    const schema = await harness.replayText('user 테이블 스키마 변경해줘');
    expect(schema.workerType).toBe(AgentType.BE_SCHEMA);

    const vacation = await harness.replayText('남은 휴가 며칠이야?');
    expect(vacation.workerType).toBe(AgentType.VACATION);
  });

  it('분류 불가 텍스트는 INTENT_CLASSIFY_FAILED', async () => {
    const harness = buildRouterHarness();
    await expect(harness.replayText('ㅁㄴㅇㄹ 아무말')).rejects.toMatchObject({
      routerErrorCode: RouterErrorCode.INTENT_CLASSIFY_FAILED,
    });
  });

  it('커스텀 분류기를 주입하면 그 결과로 라우팅한다', async () => {
    const harness = buildRouterHarness({
      classify: () => ({
        agentType: AgentType.CODE_REVIEWER,
        confidence: 1,
        reason: 'forced',
        userInstruction: 'PR 123 봐줘',
      }),
    });
    const result = await harness.replayText('무엇이든');
    expect(result.workerType).toBe(AgentType.CODE_REVIEWER);
    const lastCall = harness.calls.at(-1);
    expect(lastCall?.agentType).toBe(AgentType.CODE_REVIEWER);
    expect(lastCall?.input.conversationContext?.userInstruction).toBe(
      'PR 123 봐줘',
    );
  });

  it('followUp 주입 시 핸드오프 체인이 동작한다 (PM → BE)', async () => {
    const harness = buildRouterHarness({
      outcomeOverrides: {
        [AgentType.PM]: {
          followUp: {
            toWorker: AgentType.BE,
            reason: 'PM → BE 핸드오프',
            passthroughInput: { text: 'user repository 만들어줘' },
          },
        },
      },
    });

    const result = await harness.replayHint(AgentType.PM, 'plan');
    expect(result.workerType).toBe(AgentType.PM);
    expect(result.handoffResults).toHaveLength(1);
    expect(result.handoffResults?.[0].workerType).toBe(AgentType.BE);
    expect(result.handoffResults?.[0].formattedText).toContain(
      'user repository 만들어줘',
    );
  });
});
