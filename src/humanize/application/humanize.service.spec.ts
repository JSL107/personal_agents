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
  // 없으면 되먹임 조회가 TypeError 로 죽고 catch 가 삼켜, 되먹임이 조용히 빠진 채
  // 테스트가 통과한다.
  findRecentSucceededRuns: jest.Mock;
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
    findRecentSucceededRuns: jest.fn().mockResolvedValue([]),
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

  // 큰 입력의 대가는 품질이 아니라 시간으로만 나온다 — 윤문은 실패해도 원본을 내보내는
  // best-effort 경로라, 캡을 소진하고 원본으로 돌아오나 처음부터 원본을 내주나 결과가 같다.
  // 실측(agent_run #2090·#2095·#2100): 필드 373~385개 회차가 601초를 태우고 원본을 반환했다.
  it('필드 수가 상한을 넘으면 모델을 부르지 않고 원본을 그대로 반환한다', async () => {
    const { service, routeMock } = makeService({ enabled: 'true' });
    const 많은필드: Record<string, string> = {};
    for (let index = 0; index < 241; index += 1) {
      많은필드[`acc.${index}.memo`] = `원본${index}`;
    }

    const result = await service.humanize(많은필드);

    expect(result).toEqual(많은필드);
    expect(routeMock).not.toHaveBeenCalled();
  });

  // 건너뛴 회차가 원장에 안 남으면 "윤문이 며칠째 안 먹는다" 가 겉으로 드러나지 않는다.
  it('건너뛴 회차도 사유·개수와 함께 원장에 남긴다', async () => {
    const { service, agentRunService } = makeService({ enabled: 'true' });
    const 많은필드: Record<string, string> = {};
    for (let index = 0; index < 241; index += 1) {
      많은필드[`acc.${index}.memo`] = `원본${index}`;
    }

    await service.humanize(많은필드);

    expect(agentRunService.lastOutput).toEqual({
      skipped: 'FIELD_COUNT_EXCEEDED',
      fieldCount: 241,
      limit: 240,
    });
  });

  // 조건이 `>` 라 240개는 호출해야 한다. 경계를 고정해두지 않으면 나중에 `>=` 로 바뀌어도
  // 241개 테스트만으로는 통과해, 정상 회차가 조용히 잘리기 시작한다.
  it('필드 수가 상한과 같으면(240개) 모델을 부른다', async () => {
    const 경계필드: Record<string, string> = {};
    for (let index = 0; index < 240; index += 1) {
      경계필드[`acc.${index}.memo`] = `원본${index}`;
    }
    const { service, routeMock } = makeService({
      enabled: 'true',
      routeImpl: async () => ({ text: JSON.stringify(경계필드) }),
    });

    await service.humanize(경계필드);

    expect(routeMock).toHaveBeenCalledTimes(1);
  });

  // 건너뜀 기록은 부수 효과다 — 그것이 실패해도 결과(원본 유지)는 같아야 한다.
  it('건너뜀 기록이 실패해도 원본을 반환하고 예외를 던지지 않는다', async () => {
    const { service, agentRunService } = makeService({ enabled: 'true' });
    agentRunService.execute = jest
      .fn()
      .mockRejectedValue(new Error('원장 기록 실패')) as never;
    const 많은필드: Record<string, string> = {};
    for (let index = 0; index < 241; index += 1) {
      많은필드[`acc.${index}.memo`] = `원본${index}`;
    }

    const result = await service.humanize(많은필드);

    expect(result).toEqual(많은필드);
  });

  it('상한 이하이면 평소대로 모델을 부른다', async () => {
    const { service, routeMock } = makeService({
      enabled: 'true',
      routeImpl: async () => ({ text: JSON.stringify({ a: '다듬음A' }) }),
    });

    const result = await service.humanize({ a: '원본A' });

    expect(result).toEqual({ a: '다듬음A' });
    expect(routeMock).toHaveBeenCalledTimes(1);
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
      overRewrittenKeys: [],
      // 롤백된 필드는 변경률을 재기 전에 빠진다.
      changeRates: { safe: expect.any(Number) },
      // 이 픽스처의 원문은 20자 미만이라 길이 유지율 판정 대상이 아니다.
      lengthRetentions: {},
      translationese: {
        doublePassiveCount: 0,
        byAgentPhraseCount: 0,
        literalLightVerbCount: 0,
        inanimateSubjectPercent: 0,
      },
      preservationViolations: {
        injected: { code: 0, url: 0, pr: 1, number: 0 },
        lost: { code: 0, url: 0, pr: 1, number: 0 },
      },
      styleGaps: expect.any(Array),
    });
  });

  // 값이 숫자라는 것만 보면 계산이나 반올림이 틀려도 통과한다(리뷰 지적). 길이를 아는
  // 입력으로 정확한 값을 못박는다.
  it('길이 유지율을 원문 대비 비율로 소수 둘째 자리까지 적재한다', async () => {
    // 원문 40자 → 윤문 20자. 공백은 하나로 접힌 뒤 세므로 둘 다 공백이 없다.
    const original = '가'.repeat(40);
    const shortened = '나'.repeat(20);
    const { service, agentRunService } = makeService({
      enabled: 'true',
      routeImpl: async () => ({ text: JSON.stringify({ field: shortened }) }),
    });

    await service.humanize({ field: original });

    expect(agentRunService.lastOutput).toMatchObject({
      lengthRetentions: { field: 0.5 },
    });
  });

  it('나누어떨어지지 않는 비율은 반올림해 적재한다', async () => {
    // 30자 → 20자 = 0.666… → 0.67
    const { service, agentRunService } = makeService({
      enabled: 'true',
      routeImpl: async () => ({
        text: JSON.stringify({ field: '나'.repeat(20) }),
      }),
    });

    await service.humanize({ field: '가'.repeat(30) });

    expect(agentRunService.lastOutput).toMatchObject({
      lengthRetentions: { field: 0.67 },
    });
  });

  it('판정 대상이 아닌 짧은 필드는 적재하지 않는다 — 분포가 왜곡된다', async () => {
    const { service, agentRunService } = makeService({
      enabled: 'true',
      routeImpl: async () => ({ text: JSON.stringify({ field: '짧게 줄임' }) }),
    });

    await service.humanize({ field: '열아홉 자짜리 짧은 값이다' });

    expect(agentRunService.lastOutput).toMatchObject({ lengthRetentions: {} });
  });

  // 모델이 내용을 통째로 날리고 한 줄로 요약해 돌려주는 갈래. 숫자·고유명사를 건드리지
  // 않으므로 `content-preservation.ts` 는 이것을 잡지 못한다.
  it('원문 대비 너무 짧아진 필드는 되돌리고 경고를 남긴다', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const original =
      '재고 문서가 틀린 자리가 둘 있었고, 둘 다 범위를 넘겨 읽은 탓이었습니다.';
    const { service, agentRunService } = makeService({
      enabled: 'true',
      routeImpl: async () => ({
        text: JSON.stringify({ dropped: '틀렸어요.' }),
      }),
    });

    const result = await service.humanize({ dropped: original });

    expect(result).toEqual({ dropped: original });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('내용 날림 롤백'),
    );
    expect(agentRunService.lastOutput).toMatchObject({
      overRewrittenKeys: ['dropped'],
    });
  });

  // codex 리뷰가 반례로 낸 쌍이다. 길이를 절반으로 줄인 정상 간결화라 통과해야 한다 —
  // 변경률로 판정했다면 0.804 로 여기서 걸렸다.
  it('절반으로 줄인 정상 간결화는 되돌리지 않는다', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const concise = '지금은 이 기능을 쓸 수 없어요.';
    const { service, agentRunService } = makeService({
      enabled: 'true',
      routeImpl: async () => ({
        text: JSON.stringify({ polished: concise }),
      }),
    });

    const result = await service.humanize({
      polished:
        '현재 시점에서는 해당 기능을 사용하는 것이 불가능한 상태입니다.',
    });

    expect(result).toEqual({ polished: concise });
    expect(warnSpy).not.toHaveBeenCalled();
    expect(agentRunService.lastOutput).toMatchObject({
      overRewrittenKeys: [],
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
      overRewrittenKeys: [],
      changeRates: { count: expect.any(Number) },
      // 이 픽스처의 원문은 20자 미만이라 길이 유지율 판정 대상이 아니다.
      lengthRetentions: {},
      translationese: {
        doublePassiveCount: 0,
        byAgentPhraseCount: 0,
        literalLightVerbCount: 0,
        inanimateSubjectPercent: 0,
      },
      preservationViolations: {
        injected: { code: 0, url: 0, pr: 0, number: 0 },
        lost: { code: 0, url: 0, pr: 0, number: 1 },
      },
      styleGaps: expect.any(Array),
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
    // 본문은 없고 키 목록·보존 판정·문체 갭·변경률·번역투(전부 숫자 몇 줄)만 남는다.
    expect(executed.output).toEqual({
      humanizedKeys: ['a'],
      rolledBackKeys: [],
      overRewrittenKeys: [],
      changeRates: { a: expect.any(Number) },
      // 이 픽스처의 원문은 20자 미만이라 길이 유지율 판정 대상이 아니다.
      lengthRetentions: {},
      translationese: {
        doublePassiveCount: 0,
        byAgentPhraseCount: 0,
        literalLightVerbCount: 0,
        inanimateSubjectPercent: 0,
      },
      preservationViolations: {
        injected: { code: 0, url: 0, pr: 0, number: 0 },
        lost: { code: 0, url: 0, pr: 0, number: 0 },
      },
      styleGaps: expect.any(Array),
    });
    expect(JSON.stringify(executed.output)).not.toContain('원본A');
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

describe('문체 되먹임', () => {
  const runOf = (gaps: string[]) => ({
    id: 1,
    endedAt: new Date(),
    inputSnapshot: { voice: 'personal-blog' },
    output: { humanizedKeys: ['a'], styleGaps: gaps },
  });

  // 40문장을 넘겨야 갭 판정이 열린다(그 아래는 문장 하나가 비율을 10%p 씩 흔든다).
  //
  // 길이를 균일하게 만드는 것만으로는 갭이 생기지 않는다 — 편차·짧은문장·구어는 2026-08-26
  // 에 판정에서 내려갔다(`korean-style-metrics` 헤더의 표본 출처 문제). 남은 판정 축 중
  // 문장 내용만으로 확실히 걸리는 것이 금지접속사다.
  const gappyProse = [
    '또한 이 표본은 금지 접속사를 담고 있습니다.',
    ...Array.from(
      { length: 45 },
      (_, index) =>
        `${index}번째 문장은 목표를 벗어나도록 길게 늘여 쓴 서술입니다.`,
    ),
  ].join(' ');

  it('개인 글이면 되풀이된 갭을 systemPrompt 에 싣는다', async () => {
    const { service, routeMock, agentRunService } = makeService({
      enabled: 'true',
      routeImpl: async () => ({ text: JSON.stringify({ a: '윤문A' }) }),
    });
    // 지금도 판정 축인 항목으로 준다. 내린 축(편차·짧은문장·구어)은 소비 지점에서 걸러져
    // 프롬프트에 실리지 않는다(`style-feedback.ts` 의 `isJudgedLabel`).
    agentRunService.findRecentSucceededRuns.mockResolvedValue([
      runOf(['종결체교대 76%(≤60%)']),
      runOf(['종결체교대 71%(≤60%)']),
    ]);

    await service.humanize({ a: '원본A' }, { voice: 'personal-blog' });

    const systemPrompt = routeMock.mock.calls[0][0].request.systemPrompt;
    expect(systemPrompt).toContain('되풀이된 문체 갭');
    expect(systemPrompt).toContain('종결체교대 76%(≤60%)');
  });

  it('목소리를 조회 조건으로 내린다 — 보고서 윤문이 상한을 채워도 표본이 밀리지 않게', async () => {
    const { service, agentRunService } = makeService({
      enabled: 'true',
      routeImpl: async () => ({ text: JSON.stringify({ a: '윤문A' }) }),
    });

    await service.humanize({ a: '원본A' }, { voice: 'personal-blog' });

    const [input] = agentRunService.findRecentSucceededRuns.mock.calls[0] as [
      { inputSnapshotEquals?: { path: string[]; value: string } },
    ];
    expect(input.inputSnapshotEquals).toEqual({
      path: ['voice'],
      value: 'personal-blog',
    });
  });

  it('보고서 목소리면 원장을 조회조차 하지 않는다', async () => {
    const { service, agentRunService } = makeService({
      enabled: 'true',
      routeImpl: async () => ({ text: JSON.stringify({ a: '윤문A' }) }),
    });

    await service.humanize({ a: '원본A' }, { voice: 'report' });

    expect(agentRunService.findRecentSucceededRuns).not.toHaveBeenCalled();
  });

  it('되먹임 조회가 실패해도 윤문은 계속된다 — best-effort', async () => {
    const { service, routeMock, agentRunService } = makeService({
      enabled: 'true',
      routeImpl: async () => ({ text: JSON.stringify({ a: '윤문A' }) }),
    });
    agentRunService.findRecentSucceededRuns.mockRejectedValue(
      new Error('db down'),
    );

    const result = await service.humanize(
      { a: '원본A' },
      { voice: 'personal-blog' },
    );

    expect(result.a).toBe('윤문A');
    const systemPrompt = routeMock.mock.calls[0][0].request.systemPrompt;
    expect(systemPrompt).not.toContain('되풀이된 문체 갭');
  });

  it('측정 가능한 결과면 계산된 갭이 원장에 기록된다', async () => {
    const { service, agentRunService } = makeService({
      enabled: 'true',
      routeImpl: async () => ({ text: JSON.stringify({ a: gappyProse }) }),
    });

    // 원문도 gappyProse 다. 이 픽스처는 `${index}번째` 로 숫자를 45개 담고 있어,
    // 원문을 짧은 글로 두면 보존 가드가 그 숫자를 주입으로 보고 필드를 롤백한다.
    // 그러면 측정 대상이 짧은 원문이 되어 측정 자체가 불가능해진다(갭 0). 이 테스트가
    // 보려는 것은 보존 판정이 아니라 "측정 가능하면 갭이 기록되는가" 이므로 토큰을 맞춘다.
    await service.humanize({ a: gappyProse }, { voice: 'personal-blog' });

    const runArg = agentRunService.execute.mock.calls[0][0] as ExecuteArgs;
    const executed = await runArg.run({ agentRunId: 1 });
    const output = executed.output as { styleGaps: string[] };
    // 목표를 벗어나도록 만든 표본이라 갭이 비어 있지 않아야 한다.
    expect(output.styleGaps).toContain('금지접속사 1회(0회)');
  });

  it('모델이 비워 돌려준 필드의 원문도 측정에 포함한다', async () => {
    const { service, agentRunService } = makeService({
      enabled: 'true',
      // a 를 빈 값으로 돌려주면 어댑터는 그 문단을 원문 그대로 둔다.
      routeImpl: async () => ({
        text: JSON.stringify({ a: '', b: '짧은 윤문본.' }),
      }),
    });

    await service.humanize(
      { a: gappyProse, b: '원본B' },
      { voice: 'personal-blog' },
    );

    const runArg = agentRunService.execute.mock.calls[0][0] as ExecuteArgs;
    const executed = await runArg.run({ agentRunId: 1 });
    const output = executed.output as { styleGaps: string[] };
    // a 의 원문이 빠지면 문장 수가 임계 미만이 되고, 금지 접속사도 함께 빠져 갭이 비어 있게
    // 된다. 즉 이 단언이 서려면 빈 윤문 필드의 **원문**이 측정에 들어가야 한다.
    expect(output.styleGaps).toContain('금지접속사 1회(0회)');
  });
});
