import { WorkerStartupCoordinator } from './worker-startup.coordinator';

describe('WorkerStartupCoordinator', () => {
  it('onApplicationBootstrap 에서 BullRegistrar.register 를 한 번 호출한다(부팅 후 worker 시작)', () => {
    const register = jest.fn();
    const coordinator = new WorkerStartupCoordinator({ register } as never);

    coordinator.onApplicationBootstrap();

    expect(register).toHaveBeenCalledTimes(1);
  });
});
