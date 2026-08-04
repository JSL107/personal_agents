import { Logger } from '@nestjs/common';

import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { RedactedChange } from '../domain/subconscious.type';
import { LlmSubconsciousGate } from './llm-subconscious-gate';

function makeChange(key: string): RedactedChange {
  return {
    sourceId: 'github:pr',
    kind: 'added',
    key,
    summary: `변화 ${key}`,
  };
}

function makeGate(route: jest.Mock): {
  gate: LlmSubconsciousGate;
  errorSpy: jest.SpyInstance;
} {
  const modelRouter = { route } as unknown as ModelRouterUsecase;
  const gate = new LlmSubconsciousGate(modelRouter);
  const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  return { gate, errorSpy };
}

describe('LlmSubconsciousGate', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('변화가 없으면 모델을 호출하지 않는다', async () => {
    const route = jest.fn();
    const { gate } = makeGate(route);

    const decisions = await gate.judge([]);

    expect(decisions).toEqual([]);
    expect(route).not.toHaveBeenCalled();
  });

  it('정상 응답은 파싱해 결정으로 돌려준다', async () => {
    const route = jest.fn().mockResolvedValue({
      text: JSON.stringify([
        { changeKey: 'pr-1', promote: true, reason: '리뷰 필요' },
      ]),
    });
    const { gate } = makeGate(route);

    const decisions = await gate.judge([makeChange('pr-1')]);

    expect(decisions).toEqual([
      expect.objectContaining({ changeKey: 'pr-1', promote: true }),
    ]);
  });

  // 게이트가 죽으면 제안이 0건이 되는데, 로그가 없으면 "노이즈가 없어서 0건"인지
  // "고장나서 0건"인지 구분할 수 없다. fail-closed 는 유지하되 침묵은 막는다.
  it('모델 호출이 실패하면 제안 0건으로 처리하되 실패를 로그로 남긴다', async () => {
    const route = jest.fn().mockRejectedValue(new Error('쿼터 소진'));
    const { gate, errorSpy } = makeGate(route);

    const decisions = await gate.judge([
      makeChange('pr-1'),
      makeChange('pr-2'),
    ]);

    expect(decisions).toEqual([]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = String(errorSpy.mock.calls[0][0]);
    expect(logged).toContain('쿼터 소진');
    expect(logged).toContain('2건');
  });

  it('Error 가 아닌 값으로 실패해도 로그를 남기고 죽지 않는다', async () => {
    const route = jest.fn().mockRejectedValue('문자열 실패');
    const { gate, errorSpy } = makeGate(route);

    const decisions = await gate.judge([makeChange('pr-1')]);

    expect(decisions).toEqual([]);
    expect(String(errorSpy.mock.calls[0][0])).toContain('문자열 실패');
  });
});
