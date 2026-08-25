import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import { PreferenceProfilePort } from '../../preference-profile/domain/port/preference-profile.port';
import {
  HUMANIZE_CONCISE_RULES,
  HUMANIZE_GENERAL_AUDIENCE_TERM_LINE,
  HUMANIZE_PERSONAL_BLOG_TONE,
  HUMANIZE_REPORT_TONE_LINE,
  HUMANIZE_SYSTEM_PROMPT,
  HUMANIZE_TERM_PRESERVE_LINE,
} from '../domain/humanize-system.prompt';
import { HumanizeService } from './humanize.service';

interface ExecuteArgs {
  run: (context: { agentRunId: number }) => Promise<{
    result: unknown;
    modelUsed: string;
    output: unknown;
  }>;
}

interface AgentRunServiceMock {
  execute: jest.Mock;
  lastOutput?: unknown;
}

// 실제 execute 와 같은 계약 — run 을 실행하고 outcome 으로 감싸며, 던지면 그대로 전파한다
// (호출부가 기존처럼 원본을 반환하는 best-effort fallback 으로 받는다).
const makeAgentRunService = (): AgentRunServiceMock => {
  const agentRunService: AgentRunServiceMock = {
    execute: jest.fn().mockImplementation(async ({ run }: ExecuteArgs) => {
      const execution = await run({ agentRunId: 1 });
      agentRunService.lastOutput = execution.output;
      return {
        result: execution.result,
        modelUsed: execution.modelUsed,
        agentRunId: 1,
      };
    }),
  };
  return agentRunService;
};

const makeService = (opts: {
  enabled?: string;
  routeImpl?: () => Promise<{ text: string }>;
  preferenceProfile?: PreferenceProfilePort;
}): {
  service: HumanizeService;
  routeMock: jest.Mock;
  agentRunService: AgentRunServiceMock;
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
  afterEach(() => {
    jest.restoreAllMocks();
  });

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

  it('보존 토큰을 바꾼 필드만 원본으로 롤백하고 경고를 한 번 남긴다', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { service, agentRunService } = makeService({
      enabled: 'true',
      routeImpl: async () => ({
        text: JSON.stringify({
          changed: 'PR #278을 검토했습니다.',
          safe: '문장을 자연스럽게 다듬었습니다.',
        }),
      }),
    });

    const result = await service.humanize({
      changed: 'PR #275를 검토했습니다.',
      safe: '문장을 다듬었습니다.',
    });

    expect(result).toEqual({
      changed: 'PR #275를 검토했습니다.',
      safe: '문장을 자연스럽게 다듬었습니다.',
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('changed'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('#275'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('#278'));
    expect(agentRunService.lastOutput).toEqual({
      humanizedKeys: ['changed', 'safe'],
      rolledBackKeys: ['changed'],
      preservationViolations: {
        injected: { code: 0, url: 0, pr: 1, number: 0 },
        lost: { code: 0, url: 0, pr: 1, number: 0 },
      },
    });
  });

  it('number 소실만 있으면 윤문본을 유지하고 롤백 경고를 남기지 않는다', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { service, agentRunService } = makeService({
      enabled: 'true',
      routeImpl: async () => ({
        text: JSON.stringify({ count: '할 일이 세 개 있습니다.' }),
      }),
    });

    const result = await service.humanize({ count: '할 일이 3개 있습니다.' });

    expect(result).toEqual({ count: '할 일이 세 개 있습니다.' });
    expect(warnSpy).not.toHaveBeenCalled();
    expect(agentRunService.lastOutput).toEqual({
      humanizedKeys: ['count'],
      rolledBackKeys: [],
      preservationViolations: {
        injected: { code: 0, url: 0, pr: 0, number: 0 },
        lost: { code: 0, url: 0, pr: 0, number: 1 },
      },
    });
  });

  it('URL 롤백 경고에서 userinfo와 query, fragment를 제거한다', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const sensitiveUrl =
      'https://user:password@example.com/private/report?credential=secret#fragment';
    const { service } = makeService({
      enabled: 'true',
      routeImpl: async () => ({
        text: JSON.stringify({ link: '링크를 확인했습니다.' }),
      }),
    });

    const result = await service.humanize({ link: sensitiveUrl });

    expect(result).toEqual({ link: sensitiveUrl });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warning = String(warnSpy.mock.calls[0][0]);
    expect(warning).toContain('https://example.com/private/report');
    expect(warning).not.toContain('user:password');
    expect(warning).not.toContain('credential=secret');
    expect(warning).not.toContain('#fragment');
  });

  it('파싱할 수 없는 URL 경고도 userinfo와 query를 제거한다', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const sensitiveUrl =
      'https://user@password@[invalid/private?credential=secret#fragment';
    const { service } = makeService({
      enabled: 'true',
      routeImpl: async () => ({
        text: JSON.stringify({ link: '링크를 확인했습니다.' }),
      }),
    });

    await service.humanize({ link: sensitiveUrl });

    const warning = String(warnSpy.mock.calls[0][0]);
    expect(warning).toContain('https://[invalid/private');
    expect(warning).not.toContain('user@password');
    expect(warning).not.toContain('password@');
    expect(warning).not.toContain('credential=secret');
    expect(warning).not.toContain('#fragment');
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
        inputSnapshot: {
          fieldKeys: ['a'],
          voice: 'report',
          audience: 'developer',
        },
      }),
    );
    // 원장에는 어떤 축으로 돌았는지까지만 남고 본문은 남지 않는다.
    const snapshot = (
      agentRunService.execute.mock.calls[0][0] as {
        inputSnapshot: Record<string, unknown>;
      }
    ).inputSnapshot;
    expect(JSON.stringify(snapshot)).not.toContain('원본A');
    // 보고서 전문이 원장에 복제되면 안 된다 — 키 목록만 남긴다.
    const runArg = agentRunService.execute.mock.calls[0][0] as ExecuteArgs;
    const executed = await runArg.run({ agentRunId: 1 });
    expect(executed.output).toEqual({
      humanizedKeys: ['a'],
      rolledBackKeys: [],
      preservationViolations: {
        injected: { code: 0, url: 0, pr: 0, number: 0 },
        lost: { code: 0, url: 0, pr: 0, number: 0 },
      },
    });
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

describe('독자 축 (audience)', () => {
  const routeImpl = async () => ({ text: JSON.stringify({ a: '다듬음A' }) });

  it('지정하지 않으면 용어 보존 규칙이 그대로 간다 (기존 산출물 회귀 0)', async () => {
    const { service, routeMock } = makeService({ enabled: 'true', routeImpl });

    await service.humanize({ a: '원본A' });

    const systemPrompt = routeMock.mock.calls[0][0].request.systemPrompt;
    expect(systemPrompt).toContain(HUMANIZE_TERM_PRESERVE_LINE);
    expect(systemPrompt).not.toContain(HUMANIZE_GENERAL_AUDIENCE_TERM_LINE);
  });

  it('developer 를 명시해도 기본과 같다', async () => {
    const { service, routeMock } = makeService({ enabled: 'true', routeImpl });

    await service.humanize({ a: '원본A' }, { audience: 'developer' });

    expect(routeMock.mock.calls[0][0].request.systemPrompt).toContain(
      HUMANIZE_TERM_PRESERVE_LINE,
    );
  });

  it('general 이면 보존 규칙을 완화본으로 갈아끼운다', async () => {
    const { service, routeMock } = makeService({ enabled: 'true', routeImpl });

    await service.humanize({ a: '원본A' }, { audience: 'general' });

    const systemPrompt = routeMock.mock.calls[0][0].request.systemPrompt;
    // 덧붙이기가 아니라 치환이어야 한다 — 원본 줄이 남아 있으면 모델이 그쪽을 따라
    // 영어를 그대로 둔다(실측: 영어 낱말 121 → 129).
    expect(systemPrompt).not.toContain(HUMANIZE_TERM_PRESERVE_LINE);
    expect(systemPrompt).toContain(HUMANIZE_GENERAL_AUDIENCE_TERM_LINE);
  });

  it('목소리와 독자는 곱해서 적용된다', async () => {
    const { service, routeMock } = makeService({ enabled: 'true', routeImpl });

    await service.humanize(
      { a: '원본A' },
      { voice: 'personal-blog', audience: 'general', longForm: true },
    );

    const systemPrompt = routeMock.mock.calls[0][0].request.systemPrompt;
    expect(systemPrompt).toContain(HUMANIZE_GENERAL_AUDIENCE_TERM_LINE);
    // 목소리 축이 독자 치환에 밀려 사라지지 않았는지 함께 본다.
    expect(systemPrompt).toContain(HUMANIZE_PERSONAL_BLOG_TONE);
    expect(systemPrompt).not.toContain(HUMANIZE_REPORT_TONE_LINE);
  });
});
