import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ConsoleWriteService } from './console-write.service';

const OWNER = 'U_OWNER';

function makeService(owner?: string) {
  const config = {
    get: (key: string) =>
      key === 'CONSOLE_OWNER_SLACK_USER_ID' ? owner : undefined,
  } as unknown as ConfigService;
  const router = { dispatch: jest.fn() };
  const applyPreview = { execute: jest.fn().mockResolvedValue(undefined) };
  const cancelPreview = { execute: jest.fn().mockResolvedValue(undefined) };
  const service = new ConsoleWriteService(
    config,
    router as never,
    applyPreview as never,
    cancelPreview as never,
  );
  return { service, router, applyPreview, cancelPreview };
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
