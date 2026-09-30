import { Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { AgentType, ModelProviderName } from '../domain/model-router.type';
import { ModelCallLogInput } from '../domain/port/model-call-log.port';
import { ModelCallLogPrismaRepository } from './model-call-log.prisma.repository';

describe('ModelCallLogPrismaRepository', () => {
  const input: ModelCallLogInput = {
    agentType: AgentType.PM,
    agentRunId: null,
    status: 'SUCCEEDED',
    provider: ModelProviderName.CHATGPT,
    fallbackUsed: false,
    primaryError: null,
    fallbackError: null,
    durationMs: 1200,
  };

  let create: jest.Mock;
  let repository: ModelCallLogPrismaRepository;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    create = jest.fn().mockResolvedValue({});
    repository = new ModelCallLogPrismaRepository({
      modelCall: { create },
    } as unknown as PrismaService);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.useRealTimers();
    warn.mockRestore();
  });

  it('입력을 그대로 한 행으로 남긴다', async () => {
    await repository.record(input);

    expect(create).toHaveBeenCalledWith({ data: input });
  });

  // 테이블 미존재(db:push 전 배포)면 모든 호출이 실패한다 — 호출마다 경고하면 로그가 폭주한다.
  it('기록 실패는 삼키고, 연속 실패 경고는 억제 구간 동안 1줄로 끝낸다', async () => {
    jest.useFakeTimers();
    create.mockRejectedValue(new Error('relation "model_call" does not exist'));

    await expect(repository.record(input)).resolves.toBeUndefined();
    await repository.record(input);
    await repository.record(input);

    expect(warn).toHaveBeenCalledTimes(1);

    // 억제 구간이 지나면 다시 1줄 — 그 사이 억제된 건수를 함께 알린다.
    jest.advanceTimersByTime(10 * 60 * 1000 + 1);
    await repository.record(input);

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1][0]).toContain('직전 2건 경고 억제');
  });
});
