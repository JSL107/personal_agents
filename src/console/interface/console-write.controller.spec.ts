import { ConsoleWriteService } from '../application/console-write.service';
import { ConsoleWriteController } from './console-write.controller';

function makeController() {
  const service = {
    sendCommand: jest.fn(),
    applyApproval: jest.fn().mockResolvedValue(undefined),
    cancelApproval: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new ConsoleWriteController(
    service as unknown as ConsoleWriteService,
  );
  return { controller, service };
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
});
