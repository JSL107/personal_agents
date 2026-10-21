import { BadRequestException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';

import { SessionInjectService } from '../../local-sessions/application/session-inject.service';
import { ConsoleWriteService } from '../application/console-write.service';
import { GenerateMascotChatterUsecase } from '../application/generate-mascot-chatter.usecase';
import { ConsoleWriteController } from './console-write.controller';
import { ConsoleCommandDto } from './dto/console-command.dto';
import { MascotChatterDto } from './dto/mascot-chatter.dto';

function makeController() {
  const service = {
    sendCommand: jest.fn(),
    applyApproval: jest.fn().mockResolvedValue(undefined),
    cancelApproval: jest.fn().mockResolvedValue(undefined),
    retryRun: jest.fn().mockResolvedValue(undefined),
  };
  const sessionInject = { inject: jest.fn() };
  const chatter = {
    execute: jest
      .fn()
      .mockResolvedValue({ line: null, suggestion: null, asks: false }),
  };
  const controller = new ConsoleWriteController(
    service as unknown as ConsoleWriteService,
    sessionInject as unknown as SessionInjectService,
    chatter as unknown as GenerateMascotChatterUsecase,
  );
  return { controller, service, sessionInject, chatter };
}

describe('ConsoleWriteController', () => {
  it('거절한 후보를 chatter usecase로 전달한다', async () => {
    const { controller, chatter } = makeController();
    const result = await controller.mascotChatter({
      declinedAgentTypes: ['PM'],
    });
    expect(chatter.execute).toHaveBeenCalledWith({
      declinedAgentTypes: ['PM'],
    });
    expect(result).toEqual({ line: null, suggestion: null, asks: false });
  });

  it('declinedAgentTypes가 배열이 아니면 DTO 검증에서 거절한다', async () => {
    const invalid = Object.assign(new MascotChatterDto(), {
      declinedAgentTypes: 'PM',
    });
    const errors = await validate(invalid);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'declinedAgentTypes' }),
      ]),
    );
  });

  it('persona를 service로 전달한다', () => {
    const { controller, service } = makeController();
    controller.sendCommand({ text: '안녕', persona: 'USAGI' });
    expect(service.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ persona: 'USAGI' }),
    );
  });

  it('persona는 USAGI만 허용한다', async () => {
    const valid = Object.assign(new ConsoleCommandDto(), {
      text: '안녕',
      persona: 'USAGI',
    });
    const invalid = Object.assign(new ConsoleCommandDto(), {
      text: '안녕',
      persona: 'X',
    });
    expect(await validate(valid)).toHaveLength(0);
    expect(await validate(invalid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'persona' }),
      ]),
    );
  });
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

  it('runs/:id/retry 는 service.retryRun 위임 후 accepted 반환', async () => {
    const { controller, service } = makeController();
    const result = await controller.retryRun(42);
    expect(service.retryRun).toHaveBeenCalledWith(42);
    expect(result).toEqual({ accepted: true });
  });

  it('apply 는 service.applyApproval 위임', async () => {
    const { controller, service } = makeController();
    const result = await controller.apply('p1');
    expect(service.applyApproval).toHaveBeenCalledWith('p1');
    expect(result).toEqual({ accepted: true });
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
