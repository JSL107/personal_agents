import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ConsoleEventBus } from './console-event-bus.service';
import { ConsoleWriteService } from './console-write.service';

const OWNER = 'U_OWNER';

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeService(owner?: string) {
  const config = {
    get: (key: string) =>
      key === 'CONSOLE_OWNER_SLACK_USER_ID' ? owner : undefined,
  } as unknown as ConfigService;
  const router = { dispatch: jest.fn() };
  const applyPreview = { execute: jest.fn().mockResolvedValue(undefined) };
  const cancelPreview = { execute: jest.fn().mockResolvedValue(undefined) };
  const consoleEvents = { publish: jest.fn() };
  const service = new ConsoleWriteService(
    config,
    router as never,
    applyPreview as never,
    cancelPreview as never,
    consoleEvents as unknown as ConsoleEventBus,
  );
  return { service, router, applyPreview, cancelPreview, consoleEvents };
}

describe('ConsoleWriteService', () => {
  it('owner 설정 시 dispatch 를 REMOTE_CONSOLE source 로 위임한다', () => {
    const { service, router } = makeService(OWNER);
    router.dispatch.mockReturnValue(new Promise(() => {})); // 영원히 pending
    service.sendCommand({
      text: '오늘 할 일 정리',
      agentTypeHint: 'PM' as never,
    });
    expect(router.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'REMOTE_CONSOLE',
        slackUserId: OWNER,
        text: '오늘 할 일 정리',
        agentTypeHint: 'PM',
      }),
    );
  });

  it('sendCommand 는 dispatch 완료를 기다리지 않고 즉시 반환한다(fire-and-forget)', () => {
    const { service, router } = makeService(OWNER);
    router.dispatch.mockReturnValue(new Promise(() => {}));
    expect(() => service.sendCommand({ text: 'x' })).not.toThrow();
  });

  it('owner 미설정 시 sendCommand 는 ServiceUnavailableException', () => {
    const { service } = makeService(undefined);
    expect(() => service.sendCommand({ text: 'x' })).toThrow(
      ServiceUnavailableException,
    );
  });

  it('commandId가 있는 dispatch 거절 시 오류 메시지와 함께 command.rejected를 발행한다', async () => {
    const { service, router, consoleEvents } = makeService(OWNER);
    router.dispatch.mockRejectedValue(new Error('권한이 없습니다.'));

    service.sendCommand({ text: 'PR 해결', commandId: 'command-1' });
    await flush();

    expect(consoleEvents.publish).toHaveBeenCalledWith({
      type: 'command.rejected',
      commandId: 'command-1',
      reason: '권한이 없습니다.',
    });
  });

  it('commandId가 없는 dispatch 거절 시 콘솔 이벤트를 발행하지 않는다', async () => {
    const { service, router, consoleEvents } = makeService(OWNER);
    router.dispatch.mockRejectedValue(new Error('권한이 없습니다.'));

    service.sendCommand({ text: 'PR 해결' });
    await flush();

    expect(consoleEvents.publish).not.toHaveBeenCalled();
  });

  it('commandId와 autoResolvedNotice가 있는 dispatch 완료 시 command.info를 발행한다', async () => {
    const { service, router, consoleEvents } = makeService(OWNER);
    router.dispatch.mockResolvedValue({
      agentRunId: 1,
      workerType: 'CODE_REVIEWER',
      output: {},
      modelUsed: 'codex',
      formattedText: '완료',
      autoResolvedNotice: 'PR #42를 자동 해결 처리했습니다.',
    });

    service.sendCommand({ text: 'PR 해결', commandId: 'command-1' });
    await flush();

    expect(consoleEvents.publish).toHaveBeenCalledWith({
      type: 'command.info',
      commandId: 'command-1',
      message: 'PR #42를 자동 해결 처리했습니다.',
    });
  });

  it('applyApproval 은 owner 를 slackUserId 로 usecase 에 위임한다', async () => {
    const { service, applyPreview } = makeService(OWNER);
    await service.applyApproval('p1');
    expect(applyPreview.execute).toHaveBeenCalledWith({
      previewId: 'p1',
      slackUserId: OWNER,
    });
  });

  it('cancelApproval 은 owner 를 slackUserId 로 usecase 에 위임한다', async () => {
    const { service, cancelPreview } = makeService(OWNER);
    await service.cancelApproval('p2');
    expect(cancelPreview.execute).toHaveBeenCalledWith({
      previewId: 'p2',
      slackUserId: OWNER,
    });
  });

  it('owner 미설정 시 applyApproval 은 ServiceUnavailableException', async () => {
    const { service } = makeService(undefined);
    await expect(service.applyApproval('p1')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
