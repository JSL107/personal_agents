import { Logger } from '@nestjs/common';
import { RespondFn } from '@slack/bolt';

import { PmAgentException } from '../../agent/pm/domain/pm-agent.exception';
import { PmAgentErrorCode } from '../../agent/pm/domain/pm-agent-error-code.enum';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import {
  runAgentCommand,
  runEphemeral,
  toUserFacingErrorMessage,
} from './slack-handler.helper';

describe('toUserFacingErrorMessage', () => {
  it('DomainException 은 message 를 그대로 노출 (사용자에게 의미 있는 한국어 메시지)', () => {
    const error = new PmAgentException({
      message: '오늘 자동 수집된 할 일이 없습니다',
      code: PmAgentErrorCode.EMPTY_TASKS_INPUT,
      status: DomainStatus.NOT_FOUND,
    });
    expect(toUserFacingErrorMessage(error)).toBe(
      '오늘 자동 수집된 할 일이 없습니다',
    );
  });

  it('일반 Error 는 generic 메시지로 가린다 (Prisma/네트워크/내부 stack leak 차단)', () => {
    expect(
      toUserFacingErrorMessage(new Error('Prisma P2002 unique violation')),
    ).toBe('내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
  });

  it('비-Error 객체도 generic 으로 처리', () => {
    expect(toUserFacingErrorMessage('raw string error')).toBe(
      '내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
    );
    expect(toUserFacingErrorMessage(undefined)).toBe(
      '내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
    );
  });
});

const createSilentLogger = (): Logger =>
  ({ error: jest.fn(), warn: jest.fn() }) as unknown as Logger;

describe('runEphemeral', () => {
  it('success — task 결과를 format 으로 통과시켜 ephemeral 응답', async () => {
    const respond = jest.fn() as unknown as RespondFn;
    await runEphemeral({
      respond,
      logger: createSilentLogger(),
      commandLabel: '/sync-context',
      task: () => Promise.resolve({ count: 3 }),
      format: (r) => `결과: ${r.count}`,
    });
    expect(respond).toHaveBeenCalledWith({
      response_type: 'ephemeral',
      replace_original: true,
      text: '결과: 3',
    });
  });

  it('DomainException — 도메인 메시지 그대로 응답에 포함', async () => {
    const respond = jest.fn() as unknown as RespondFn;
    const logger = createSilentLogger();
    await runEphemeral({
      respond,
      logger,
      commandLabel: '/sync-context',
      task: () =>
        Promise.reject(
          new PmAgentException({
            message: '컨텍스트 없음',
            code: PmAgentErrorCode.EMPTY_TASKS_INPUT,
            status: DomainStatus.NOT_FOUND,
          }),
        ),
      format: () => 'unused',
    });
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '이대리 /sync-context 실패: 컨텍스트 없음',
      }),
    );
    expect(logger.error).toHaveBeenCalled();
  });

  it('unknown error — generic 메시지로 마스킹 + logger.error 로 raw stack 보존', async () => {
    const respond = jest.fn() as unknown as RespondFn;
    const logger = createSilentLogger();
    await runEphemeral({
      respond,
      logger,
      commandLabel: '/quota',
      task: () =>
        Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:5434')),
      format: () => 'unused',
    });
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '이대리 /quota 실패: 내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
      }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('ECONNREFUSED'),
      expect.any(String),
    );
  });
});

describe('runAgentCommand', () => {
  it('success — format(result) + formatModelFooter (model + run id) 자동 부착', async () => {
    const respond = jest.fn() as unknown as RespondFn;
    await runAgentCommand({
      respond,
      logger: createSilentLogger(),
      commandLabel: '/today',
      execute: () =>
        Promise.resolve({
          result: { plan: '오늘의 계획' },
          modelUsed: 'codex-cli',
          agentRunId: 42,
        }),
      format: (r) => `📋 ${r.plan}`,
    });
    expect(respond).toHaveBeenCalledTimes(1);
    const arg = (respond as jest.Mock).mock.calls[0][0] as { text: string };
    expect(arg.text).toContain('📋 오늘의 계획');
    expect(arg.text).toContain('_model: codex-cli · run #42_');
  });

  it('DomainException — 도메인 메시지 응답 + log.error', async () => {
    const respond = jest.fn() as unknown as RespondFn;
    const logger = createSilentLogger();
    await runAgentCommand({
      respond,
      logger,
      commandLabel: '/today',
      execute: () =>
        Promise.reject(
          new PmAgentException({
            message: 'Slack mention fetch 실패',
            code: PmAgentErrorCode.EMPTY_TASKS_INPUT,
            status: DomainStatus.INTERNAL,
          }),
        ),
      format: () => 'unused',
    });
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '이대리 /today 실패: Slack mention fetch 실패',
      }),
    );
    expect(logger.error).toHaveBeenCalled();
  });

  it('unknown error — generic 마스킹 + raw 메시지는 logger.error 에만', async () => {
    const respond = jest.fn() as unknown as RespondFn;
    const logger = createSilentLogger();
    await runAgentCommand({
      respond,
      logger,
      commandLabel: '/review-pr',
      execute: () => Promise.reject(new Error('Bad gateway 502')),
      format: () => 'unused',
    });
    const arg = (respond as jest.Mock).mock.calls[0][0] as { text: string };
    expect(arg.text).toBe(
      '이대리 /review-pr 실패: 내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
    );
    expect(arg.text).not.toContain('Bad gateway');
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Bad gateway 502'),
      expect.any(String),
    );
  });
});

describe('runAgentCommand — onOutcome 후처리', () => {
  it('성공 시 outcome 을 onOutcome 으로 전달 (재시도 계보 연결 지점)', async () => {
    const respond = jest.fn() as unknown as RespondFn;
    const onOutcome = jest.fn().mockResolvedValue(undefined);
    await runAgentCommand({
      respond,
      logger: createSilentLogger(),
      commandLabel: '/retry-run(PM)',
      execute: () =>
        Promise.resolve({
          result: { plan: '재실행 계획' },
          modelUsed: 'codex-cli',
          agentRunId: 77,
        }),
      format: (r) => r.plan,
      onOutcome,
    });
    expect(onOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ agentRunId: 77 }),
    );
  });

  it('execute 실패 시 onOutcome 미호출 (실패한 실행에 계보를 붙이지 않는다)', async () => {
    const respond = jest.fn() as unknown as RespondFn;
    const onOutcome = jest.fn().mockResolvedValue(undefined);
    await runAgentCommand({
      respond,
      logger: createSilentLogger(),
      commandLabel: '/retry-run(PM)',
      execute: () => Promise.reject(new Error('codex 호출 실패')),
      format: () => 'unused',
      onOutcome,
    });
    expect(onOutcome).not.toHaveBeenCalled();
  });

  it('onOutcome 실패는 사용자 응답을 막지 않고 warn 만 남긴다', async () => {
    const respond = jest.fn() as unknown as RespondFn;
    const logger = createSilentLogger();
    await runAgentCommand({
      respond,
      logger,
      commandLabel: '/retry-run(PM)',
      execute: () =>
        Promise.resolve({
          result: { plan: '재실행 계획' },
          modelUsed: 'codex-cli',
          agentRunId: 78,
        }),
      format: (r) => r.plan,
      onOutcome: () => Promise.reject(new Error('DB 연결 끊김')),
    });
    const arg = (respond as jest.Mock).mock.calls[0][0] as { text: string };
    expect(arg.text).toContain('재실행 계획');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('DB 연결 끊김'),
    );
  });

  it('onOutcome 미지정이면 기존 동작 그대로 (기존 호출부 무영향)', async () => {
    const respond = jest.fn() as unknown as RespondFn;
    await runAgentCommand({
      respond,
      logger: createSilentLogger(),
      commandLabel: '/today',
      execute: () =>
        Promise.resolve({
          result: { plan: '오늘의 계획' },
          modelUsed: 'codex-cli',
          agentRunId: 42,
        }),
      format: (r) => `📋 ${r.plan}`,
    });
    const arg = (respond as jest.Mock).mock.calls[0][0] as { text: string };
    expect(arg.text).toContain('📋 오늘의 계획');
    expect(arg.text).toContain('_model: codex-cli · run #42_');
  });
});
