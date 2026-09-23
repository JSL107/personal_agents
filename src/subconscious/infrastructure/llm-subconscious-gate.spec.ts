import { Logger } from '@nestjs/common';

import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
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

// 실제 execute 와 같은 계약으로 흉내낸다 — run 을 실행하고 결과를 outcome 으로 감싸며,
// run 이 던지면 그대로 다시 던진다(원장은 FAILED 로 마감된 뒤 호출부가 fail-closed 로 받는다).
function makeAgentRunService(): { execute: jest.Mock } {
  return {
    execute: jest.fn().mockImplementation(async ({ run }: ExecuteArgs) => {
      const execution = await run({ agentRunId: 1 });
      return {
        result: execution.result,
        modelUsed: execution.modelUsed,
        agentRunId: 1,
      };
    }),
  };
}

interface ExecuteArgs {
  run: (context: {
    agentRunId: number;
  }) => Promise<{ result: unknown; modelUsed: string }>;
}

function makeGate(route: jest.Mock): {
  gate: LlmSubconsciousGate;
  errorSpy: jest.SpyInstance;
  agentRunService: { execute: jest.Mock };
} {
  const modelRouter = { route } as unknown as ModelRouterUsecase;
  const agentRunService = makeAgentRunService();
  const gate = new LlmSubconsciousGate(modelRouter, agentRunService as never);
  const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  return { gate, errorSpy, agentRunService };
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

  it('판정을 실행 원장으로 감싼다', async () => {
    const route = jest.fn().mockResolvedValue({ text: '[]' });
    const { gate, agentRunService } = makeGate(route);

    await gate.judge([makeChange('pr-1')]);

    // 로그는 휘발되지만 원장은 남는다 — 실패율·소요시간을 보는 유일한 표면이다.
    expect(agentRunService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: AgentType.SUBCONSCIOUS_GATE,
        triggerType: TriggerType.SUBCONSCIOUS_TICK,
      }),
    );
  });

  // 게이트가 죽으면 제안이 0건이 되는데, 로그가 없으면 "노이즈가 없어서 0건"인지
  // "고장나서 0건"인지 구분할 수 없다. fail-closed 는 유지하되 침묵은 막는다.
  it('모델 호출이 실패하면 제안 0건으로 처리하되 실패를 로그로 남긴다', async () => {
    const route = jest.fn().mockRejectedValue(new Error('쿼터 소진'));
    const { gate, errorSpy, agentRunService } = makeGate(route);

    const decisions = await gate.judge([
      makeChange('pr-1'),
      makeChange('pr-2'),
    ]);

    expect(decisions).toEqual([]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = String(errorSpy.mock.calls[0][0]);
    expect(logged).toContain('쿼터 소진');
    expect(logged).toContain('2건');
    // fail-closed 를 유지하되 실패 자체는 원장에 들어가야 한다 — 그래야 며칠 연속
    // 0건인 것이 "노이즈 없음" 이 아니라 "고장" 이라는 사실이 집계로 드러난다.
    expect(agentRunService.execute).toHaveBeenCalledTimes(1);
  });

  // 2026-09-17~19 사고. claude 폴백이 응답을 코드펜스로 감싸 보내 86 회차가 전건 유실됐다.
  it('코드펜스로 감싼 응답도 판정으로 읽는다', async () => {
    const inner = JSON.stringify([
      { changeKey: 'pr-1', promote: true, reason: '리뷰 필요' },
    ]);
    const route = jest
      .fn()
      .mockResolvedValue({ text: `\`\`\`json\n${inner}\n\`\`\`` });
    const { gate, errorSpy } = makeGate(route);

    const decisions = await gate.judge([makeChange('pr-1')]);

    expect(decisions).toHaveLength(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  // 승격하지 않기로 한 변화도 `promote: false` 로 남는다 — 판정 수가 입력 수에 미달하면
  // 그만큼이 유실된 것이다. 실측 569 정상 회차는 전건 판정 수 = 입력 수였다.
  it('일부만 판정되면 누락 건수를 로그로 남긴다', async () => {
    const route = jest.fn().mockResolvedValue({
      text: JSON.stringify([
        { changeKey: 'pr-1', promote: false, reason: '노이즈' },
      ]),
      modelUsed: 'claude-cli',
    });
    const { gate, errorSpy } = makeGate(route);

    const decisions = await gate.judge([
      makeChange('pr-1'),
      makeChange('pr-2'),
    ]);

    expect(decisions).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = String(errorSpy.mock.calls[0][0]);
    expect(logged).toContain('2건 중 1건만 판정됨');
    expect(logged).toContain('claude-cli');
  });

  // 모델이 형식은 지켰지만 빈 배열을 돌려준 경우. 결과는 제안 0건으로 같지만 원인이
  // "노이즈가 없었다" 가 아니라 "판정을 안 했다" 라 침묵시키지 않는다.
  it('빈 배열을 돌려줘도 입력이 있으면 누락으로 본다', async () => {
    const route = jest.fn().mockResolvedValue({ text: '[]' });
    const { gate, errorSpy } = makeGate(route);

    const decisions = await gate.judge([makeChange('pr-1')]);

    expect(decisions).toEqual([]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain('판정 누락');
  });

  it('Error 가 아닌 값으로 실패해도 로그를 남기고 죽지 않는다', async () => {
    const route = jest.fn().mockRejectedValue('문자열 실패');
    const { gate, errorSpy } = makeGate(route);

    const decisions = await gate.judge([makeChange('pr-1')]);

    expect(decisions).toEqual([]);
    expect(String(errorSpy.mock.calls[0][0])).toContain('문자열 실패');
  });
});
