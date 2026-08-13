import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AgentType } from '../../model-router/domain/model-router.type';
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
  const pendingTurns = {
    peek: jest.fn().mockReturnValue(null),
    consume: jest.fn(),
  };
  const service = new ConsoleWriteService(
    config,
    chainOrchestrator as never,
    applyPreview as never,
    cancelPreview as never,
    pendingTurns as never,
  );
  return {
    service,
    chainOrchestrator,
    applyPreview,
    cancelPreview,
    pendingTurns,
  };
}

describe('ConsoleWriteService', () => {
  it('보관된 제안에 2번으로 답하면 두 번째 worker를 agentTypeHint로 착수시킨다', () => {
    const { service, chainOrchestrator, pendingTurns } = makeService(OWNER);
    pendingTurns.peek.mockReturnValue({
      kind: 'SUGGESTIONS',
      suggestions: [
        {
          agentType: AgentType.PM,
          displayName: 'PM',
          reason: '첫 번째',
        },
        {
          agentType: AgentType.CODE_REVIEWER,
          displayName: 'Code Reviewer',
          reason: '두 번째',
        },
      ],
    });

    service.sendCommand({ text: '2번', commandId: 'c2' });

    expect(pendingTurns.consume).toHaveBeenCalledWith(OWNER);
    expect(chainOrchestrator.run).toHaveBeenCalledWith({
      slackUserId: OWNER,
      agentTypeHint: AgentType.CODE_REVIEWER,
      text: undefined,
      commandId: 'c2',
    });
  });

  it('보관된 제안이 없으면 번호 입력도 기존 일반 경로로 보낸다', () => {
    const { service, chainOrchestrator, pendingTurns } = makeService(OWNER);

    service.sendCommand({ text: '2번', commandId: 'c2' });

    expect(pendingTurns.consume).not.toHaveBeenCalled();
    expect(chainOrchestrator.run).toHaveBeenCalledWith({
      slackUserId: OWNER,
      text: '2번',
      agentTypeHint: undefined,
      commandId: 'c2',
    });
  });

  it('입력 대기 중 3번은 번호가 아니라 같은 worker의 인자로 전달한다', () => {
    const { service, chainOrchestrator, pendingTurns } = makeService(OWNER);
    pendingTurns.peek.mockReturnValue({
      kind: 'AWAITING_INPUT',
      agentType: AgentType.WORK_REVIEWER,
      displayName: 'Work Reviewer',
    });

    service.sendCommand({ text: '3번', commandId: 'c3' });

    expect(pendingTurns.consume).toHaveBeenCalledWith(OWNER);
    expect(chainOrchestrator.run).toHaveBeenCalledWith({
      slackUserId: OWNER,
      agentTypeHint: AgentType.WORK_REVIEWER,
      text: '3번',
      commandId: 'c3',
    });
  });

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
