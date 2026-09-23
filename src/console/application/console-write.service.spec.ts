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
  const applyPreview = {
    assertApplicable: jest.fn().mockResolvedValue(undefined),
    execute: jest.fn().mockResolvedValue(undefined),
  };
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

  it('명시적 agentTypeHint가 있으면 제안 번호를 해석하지 않고 본문과 보관을 유지한다', () => {
    const { service, chainOrchestrator, pendingTurns } = makeService(OWNER);
    pendingTurns.peek.mockReturnValue({
      kind: 'SUGGESTIONS',
      suggestions: [
        {
          agentType: AgentType.CODE_REVIEWER,
          displayName: 'Code Reviewer',
          reason: '첫 번째',
        },
        {
          agentType: AgentType.WORK_REVIEWER,
          displayName: 'Work Reviewer',
          reason: '두 번째',
        },
      ],
    });

    service.sendCommand({
      text: '2번 이슈 검토',
      agentTypeHint: AgentType.PM,
      commandId: 'c2',
    });

    expect(pendingTurns.consume).not.toHaveBeenCalled();
    expect(chainOrchestrator.run).toHaveBeenCalledWith({
      slackUserId: OWNER,
      text: '2번 이슈 검토',
      agentTypeHint: AgentType.PM,
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
    expect(applyPreview.assertApplicable).toHaveBeenCalledWith({
      previewId: 'p1',
      slackUserId: OWNER,
    });
    expect(applyPreview.execute).toHaveBeenCalledWith({
      previewId: 'p1',
      slackUserId: OWNER,
    });
  });

  // 이 계약이 깨지면 증상이 조용히 돌아온다 — 응답이 반영이 끝날 때까지 늦어지고,
  // 클라이언트가 먼저 끊어 정상 승인이 실패로 보인다.
  it('applyApproval 은 반영이 안 끝나도 접수에서 먼저 반환한다', async () => {
    const { service, applyPreview } = makeService(OWNER);
    let finishApply: () => void = () => undefined;
    applyPreview.execute.mockReturnValue(
      new Promise<void>((resolve) => {
        finishApply = resolve;
      }),
    );

    let accepted = false;
    const pending = service.applyApproval('p1').then(() => {
      accepted = true;
    });
    await pending;

    expect(accepted).toBe(true);
    expect(applyPreview.execute).toHaveBeenCalled();
    finishApply();
  });

  it('접수 검증이 거절하면 반영을 시작하지 않고 사유를 그대로 올린다', async () => {
    const { service, applyPreview } = makeService(OWNER);
    applyPreview.assertApplicable.mockRejectedValue(new Error('이미 처리 중'));

    await expect(service.applyApproval('p1')).rejects.toThrow('이미 처리 중');
    expect(applyPreview.execute).not.toHaveBeenCalled();
  });

  // 접수 뒤의 실패는 이미 접수 응답을 보낸 뒤라 호출자에게 돌려줄 곳이 없다. 삼키되
  // 로그로 남긴다 — 여기서 reject 하면 처리되지 않은 프로미스 거부가 된다.
  it('반영이 실패해도 접수는 성공으로 끝난다', async () => {
    const { service, applyPreview } = makeService(OWNER);
    applyPreview.execute.mockRejectedValue(new Error('applier 실패'));

    await expect(service.applyApproval('p1')).resolves.toBeUndefined();
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
