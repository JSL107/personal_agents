import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ConsoleWriteService } from './console-write.service';

const OWNER = 'U_OWNER';

function makeService(owner?: string) {
  const config = {
    get: (key: string) =>
      key === 'CONSOLE_OWNER_SLACK_USER_ID' ? owner : undefined,
  } as unknown as ConfigService;
  const chainOrchestrator = { run: jest.fn().mockResolvedValue(undefined) };
  const applyPreview = { execute: jest.fn().mockResolvedValue(undefined) };
  const cancelPreview = { execute: jest.fn().mockResolvedValue(undefined) };
  const service = new ConsoleWriteService(
    config,
    chainOrchestrator as never,
    applyPreview as never,
    cancelPreview as never,
  );
  return { service, chainOrchestrator, applyPreview, cancelPreview };
}

describe('ConsoleWriteService', () => {
  it('owner 설정 시 orchestrator 에 REMOTE_CONSOLE 지시를 위임한다', () => {
    const { service, chainOrchestrator } = makeService(OWNER);
    service.sendCommand({
      text: '오늘 할 일 정리',
      agentTypeHint: 'PM' as never,
      commandId: 'c1',
    });
    expect(chainOrchestrator.run).toHaveBeenCalledWith({
      slackUserId: OWNER,
      text: '오늘 할 일 정리',
      agentTypeHint: 'PM',
      commandId: 'c1',
    });
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
