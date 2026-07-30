import { BadRequestException, NotFoundException } from '@nestjs/common';

import { SessionInjectService } from '../../local-sessions/application/session-inject.service';
import { ConsoleWriteService } from '../application/console-write.service';
import { ConsoleWriteController } from './console-write.controller';

function makeController() {
  const service = {
    sendCommand: jest.fn(),
    applyApproval: jest.fn().mockResolvedValue(undefined),
    cancelApproval: jest.fn().mockResolvedValue(undefined),
  };
  const sessionInject = { inject: jest.fn() };
  const controller = new ConsoleWriteController(
    service as unknown as ConsoleWriteService,
    sessionInject as unknown as SessionInjectService,
  );
  return { controller, service, sessionInject };
}

describe('ConsoleWriteController', () => {
  it('command 는 service.sendCommand 위임 후 accepted 반환', () => {
    const { controller, service } = makeController();
    const result = controller.sendCommand({
      text: '분배해줘',
      agentTypeHint: 'CTO',
      commandId: 'command-1',
    });
    expect(service.sendCommand).toHaveBeenCalledWith({
      text: '분배해줘',
      agentTypeHint: 'CTO',
      commandId: 'command-1',
    });
    expect(result).toEqual({ accepted: true });
  });

  it('apply 는 service.applyApproval 위임', async () => {
    const { controller, service } = makeController();
    const result = await controller.apply('p1');
    expect(service.applyApproval).toHaveBeenCalledWith('p1');
    expect(result).toEqual({ ok: true });
  });

  it('cancel 은 service.cancelApproval 위임', async () => {
    const { controller, service } = makeController();
    const result = await controller.cancel('p2');
    expect(service.cancelApproval).toHaveBeenCalledWith('p2');
    expect(result).toEqual({ ok: true });
  });

  it('inject 성공 시 202 바디 반환', () => {
    const { controller, sessionInject } = makeController();
    sessionInject.inject.mockReturnValue({ ok: true });
    const result = controller.injectToSession('s1', { text: '고쳐' });
    expect(sessionInject.inject).toHaveBeenCalledWith('s1', '고쳐');
    expect(result).toEqual({ ok: true, deliver: 'next-stop' });
  });

  it('빈 지시는 BadRequestException', () => {
    const { controller, sessionInject } = makeController();
    sessionInject.inject.mockReturnValue({
      ok: false,
      reason: 'EMPTY_INSTRUCTION',
    });
    expect(() => controller.injectToSession('s1', { text: '  ' })).toThrow(
      BadRequestException,
    );
  });

  it('없는 세션은 NotFoundException', () => {
    const { controller, sessionInject } = makeController();
    sessionInject.inject.mockReturnValue({
      ok: false,
      reason: 'SESSION_NOT_FOUND',
    });
    expect(() => controller.injectToSession('nope', { text: '고쳐' })).toThrow(
      NotFoundException,
    );
  });
});
