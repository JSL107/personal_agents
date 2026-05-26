import { Logger } from '@nestjs/common';

import { AgentType } from '../../model-router/domain/model-router.type';
import { RouterErrorCode } from '../domain/router-error-code.enum';
import { IdaeriRouterUsecase } from './idaeri-router.usecase';

const buildUsecase = (): IdaeriRouterUsecase => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  return new IdaeriRouterUsecase();
};

describe('IdaeriRouterUsecase — scaffold 단계', () => {
  it('agentTypeHint 가 없으면 INTENT_HINT_REQUIRED throw', async () => {
    const usecase = buildUsecase();

    await expect(
      usecase.dispatch({
        source: 'SLACK_MESSAGE',
        slackUserId: 'U1',
        text: '안녕',
      }),
    ).rejects.toMatchObject({
      routerErrorCode: RouterErrorCode.INTENT_HINT_REQUIRED,
    });
  });

  it('agentTypeHint 가 명시돼도 worker dispatcher registry 미도입 단계라 UNSUPPORTED_AGENT_TYPE throw', async () => {
    const usecase = buildUsecase();

    await expect(
      usecase.dispatch({
        source: 'SLACK_COMMAND',
        slackUserId: 'U1',
        agentTypeHint: AgentType.PM,
      }),
    ).rejects.toMatchObject({
      routerErrorCode: RouterErrorCode.UNSUPPORTED_AGENT_TYPE,
    });
  });

  it('source / contextRefs 가 input 에 정상 전달돼도 본 단계에서는 throw 동작 동일', async () => {
    const usecase = buildUsecase();

    await expect(
      usecase.dispatch({
        source: 'CRON',
        slackUserId: 'U1',
        agentTypeHint: AgentType.WORK_REVIEWER,
        contextRefs: { agentRunId: 42 },
      }),
    ).rejects.toMatchObject({
      routerErrorCode: RouterErrorCode.UNSUPPORTED_AGENT_TYPE,
    });
  });
});
