import { ConfigService } from '@nestjs/config';

import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import { PreferenceProfilePort } from '../../preference-profile/domain/port/preference-profile.port';
import {
  HUMANIZE_CONCISE_RULES,
  HUMANIZE_SYSTEM_PROMPT,
} from '../domain/humanize-system.prompt';
import { HumanizeService } from './humanize.service';

interface ExecuteArgs {
  run: (context: { agentRunId: number }) => Promise<{
    result: unknown;
    modelUsed: string;
    output: unknown;
  }>;
}

// 실제 execute 와 같은 계약 — run 을 실행하고 outcome 으로 감싸며, 던지면 그대로 전파한다
// (호출부가 기존처럼 원본을 반환하는 best-effort fallback 으로 받는다).
const makeAgentRunService = (): { execute: jest.Mock } => ({
  execute: jest.fn().mockImplementation(async ({ run }: ExecuteArgs) => {
    const execution = await run({ agentRunId: 1 });
    return {
      result: execution.result,
      modelUsed: execution.modelUsed,
      agentRunId: 1,
    };
  }),
});

const makeService = (opts: {
  enabled?: string;
  routeImpl?: () => Promise<{ text: string }>;
  preferenceProfile?: PreferenceProfilePort;
}): {
  service: HumanizeService;
  routeMock: jest.Mock;
  agentRunService: { execute: jest.Mock };
} => {
  const routeMock = jest.fn(opts.routeImpl ?? (async () => ({ text: '{}' })));
  const modelRouter = { route: routeMock } as unknown as ModelRouterUsecase;
  const configService = {
    get: (key: string) =>
      key === 'HUMANIZE_REPORTS_ENABLED' ? opts.enabled : undefined,
  } as unknown as ConfigService;
  const agentRunService = makeAgentRunService();
  return {
    service: new HumanizeService(
      modelRouter,
      configService,
      agentRunService as never,
      opts.preferenceProfile,
    ),
    routeMock,
    agentRunService,
  };
};

describe('HumanizeService', () => {
  it('정상 윤문 시 같은 키로 다듬은 값을 반환한다', async () => {
    const { service } = makeService({
      enabled: 'true',
      routeImpl: async () => ({
        text: JSON.stringify({ a: '다듬음A', b: '다듬음B' }),
      }),
    });
    const result = await service.humanize({ a: '원본A', b: '원본B' });
    expect(result).toEqual({ a: '다듬음A', b: '다듬음B' });
  });

  it('env 가 false 면 LLM 호출 없이 원본을 반환한다', async () => {
    const { service, routeMock } = makeService({ enabled: 'false' });
    const result = await service.humanize({ a: '원본A' });
    expect(result).toEqual({ a: '원본A' });
    expect(routeMock).not.toHaveBeenCalled();
  });

  it('키 불일치 출력이면 원본을 반환한다', async () => {
    const { service } = makeService({
      enabled: 'true',
      routeImpl: async () => ({ text: JSON.stringify({ a: 'x' }) }),
    });
    const result = await service.humanize({ a: '원본A', b: '원본B' });
    expect(result).toEqual({ a: '원본A', b: '원본B' });
  });

  it('route 가 throw 하면 원본을 반환한다', async () => {
    const { service, agentRunService } = makeService({
      enabled: 'true',
      routeImpl: async () => {
        throw new Error('codex quota');
      },
    });
    const result = await service.humanize({ a: '원본A' });
    expect(result).toEqual({ a: '원본A' });
    // best-effort 라 보고서는 막지 않되, 실패했다는 사실은 원장에 남아야 한다.
    // 그러지 않으면 윤문이 며칠째 안 먹어도 산출물이 멀쩡해 보여 아무도 눈치채지 못한다.
    expect(agentRunService.execute).toHaveBeenCalledTimes(1);
  });

  it('윤문을 실행 원장으로 감싸고 본문은 원장에 담지 않는다', async () => {
    const { service, agentRunService } = makeService({
      enabled: 'true',
      routeImpl: async () => ({ text: JSON.stringify({ a: '다듬은A' }) }),
    });

    await service.humanize({ a: '원본A' });

    expect(agentRunService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: AgentType.HUMANIZER,
        triggerType: TriggerType.REPORT_HUMANIZE,
        inputSnapshot: { fieldKeys: ['a'] },
      }),
    );
    // 보고서 전문이 원장에 복제되면 안 된다 — 키 목록만 남긴다.
    const runArg = agentRunService.execute.mock.calls[0][0] as ExecuteArgs;
    const executed = await runArg.run({ agentRunId: 1 });
    expect(executed.output).toEqual({ humanizedKeys: ['a'] });
  });

  it('빈 값만 있으면 LLM 호출 없이 원본을 반환한다', async () => {
    const { service, routeMock } = makeService({ enabled: 'true' });
    const result = await service.humanize({ a: '', b: '   ' });
    expect(result).toEqual({ a: '', b: '   ' });
    expect(routeMock).not.toHaveBeenCalled();
  });

  describe('preference profile 주입', () => {
    it('프로필 주입 시 systemPrompt 에 인젝션 블록이 포함된다', async () => {
      const injectionText = '사용자 문체 선호:\n- 문체: __TEST_SENTINEL__';
      const preferenceProfile: PreferenceProfilePort = {
        getInjectionBlock: jest.fn().mockResolvedValue(injectionText),
      };
      const { service, routeMock } = makeService({
        enabled: 'true',
        routeImpl: async () => ({ text: JSON.stringify({ a: '다듬음A' }) }),
        preferenceProfile,
      });

      await service.humanize({ a: '원본A' });

      const callArg = routeMock.mock.calls[0][0];
      expect(callArg.request.systemPrompt).toContain('__TEST_SENTINEL__');
      expect(callArg.request.systemPrompt).toContain('사용자 문체 선호');
      expect(callArg.request.systemPrompt).toContain(HUMANIZE_SYSTEM_PROMPT);
    });

    it('프로필 미주입 시 기존 systemPrompt 그대로 호출된다', async () => {
      const { service, routeMock } = makeService({
        enabled: 'true',
        routeImpl: async () => ({ text: JSON.stringify({ a: '다듬음A' }) }),
      });

      await service.humanize({ a: '원본A' });

      const callArg = routeMock.mock.calls[0][0];
      expect(callArg.request.systemPrompt).toBe(
        `${HUMANIZE_SYSTEM_PROMPT}\n${HUMANIZE_CONCISE_RULES}`,
      );
    });
  });

  describe('길이 예산', () => {
    // 이 절이 빠지면 윤문이 원문보다 길어진다(2026-08-11 회고 실측: 782자 → 876자).
    it('기본은 간결 모드 — 길이 예산을 붙여 호출한다', async () => {
      const { service, routeMock } = makeService({
        enabled: 'true',
        routeImpl: async () => ({ text: JSON.stringify({ a: '다듬음A' }) }),
      });

      await service.humanize({ a: '원본A' });

      expect(routeMock.mock.calls[0][0].request.systemPrompt).toContain(
        HUMANIZE_CONCISE_RULES,
      );
    });

    it('longForm 이면 길이 예산을 붙이지 않는다 (블로그 본문·이력서 분량 보존)', async () => {
      const { service, routeMock } = makeService({
        enabled: 'true',
        routeImpl: async () => ({ text: JSON.stringify({ a: '다듬음A' }) }),
      });

      await service.humanize({ a: '원본A' }, { longForm: true });

      expect(routeMock.mock.calls[0][0].request.systemPrompt).not.toContain(
        HUMANIZE_CONCISE_RULES,
      );
    });
  });
});
