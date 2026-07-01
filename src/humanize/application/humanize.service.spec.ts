import { ConfigService } from '@nestjs/config';

import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { PreferenceProfilePort } from '../../preference-profile/domain/port/preference-profile.port';
import { HUMANIZE_SYSTEM_PROMPT } from '../domain/humanize-system.prompt';
import { HumanizeService } from './humanize.service';

const makeService = (opts: {
  enabled?: string;
  routeImpl?: () => Promise<{ text: string }>;
  preferenceProfile?: PreferenceProfilePort;
}): { service: HumanizeService; routeMock: jest.Mock } => {
  const routeMock = jest.fn(opts.routeImpl ?? (async () => ({ text: '{}' })));
  const modelRouter = { route: routeMock } as unknown as ModelRouterUsecase;
  const configService = {
    get: (key: string) =>
      key === 'HUMANIZE_REPORTS_ENABLED' ? opts.enabled : undefined,
  } as unknown as ConfigService;
  return {
    service: new HumanizeService(
      modelRouter,
      configService,
      opts.preferenceProfile,
    ),
    routeMock,
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
    const { service } = makeService({
      enabled: 'true',
      routeImpl: async () => {
        throw new Error('codex quota');
      },
    });
    const result = await service.humanize({ a: '원본A' });
    expect(result).toEqual({ a: '원본A' });
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
      expect(callArg.request.systemPrompt).toBe(HUMANIZE_SYSTEM_PROMPT);
    });
  });
});
