import { ScheduleItemRecord, ScheduleStatus } from '../domain/schedule.type';
import { RegisterConsoleScheduleUsecase } from './register-console-schedule.usecase';
import { RegisterScheduleUsecase } from './register-schedule.usecase';

// 이 usecase 가 존재하는 이유는 **알림을 콘솔 경로에만 붙이기 위해서**다. Slack 발화 경로가
// 쓰는 `RegisterScheduleUsecase` 안에 알림을 넣었다면 Slack 으로 등록한 사람이 Router 의 답과
// 이 알림을 같은 채널에서 두 번 받는다. 그 경계가 이 스위트가 지키는 것이다.
describe('RegisterConsoleScheduleUsecase', () => {
  const record: ScheduleItemRecord = {
    id: 1,
    slackUserId: 'U123',
    title: '자동차세 납부',
    dueDate: new Date('2026-09-30T00:00:00.000Z'),
    dueTime: null,
    linkUrl: null,
    memo: null,
    status: ScheduleStatus.OPEN,
    completedAt: null,
    isHoliday: false,
  };
  const input = {
    slackUserId: 'U123',
    title: '자동차세 납부',
    dueDate: { year: 2026, month: 9, day: 30 },
  };

  const build = (notifyImpl?: jest.Mock) => {
    const registerSchedule: jest.Mocked<
      Pick<RegisterScheduleUsecase, 'execute'>
    > = { execute: jest.fn().mockResolvedValue(record) };
    const notifier = {
      notifyRegistered: notifyImpl ?? jest.fn().mockResolvedValue(undefined),
    };
    const usecase = new RegisterConsoleScheduleUsecase(
      registerSchedule as unknown as RegisterScheduleUsecase,
      notifier,
    );
    return { usecase, registerSchedule, notifier };
  };

  it('저장한 뒤 그 기록으로 알린다', async () => {
    const { usecase, registerSchedule, notifier } = build();

    const result = await usecase.execute(input);

    expect(registerSchedule.execute).toHaveBeenCalledWith(input);
    expect(notifier.notifyRegistered).toHaveBeenCalledWith(record);
    expect(result).toBe(record);
  });

  it('저장이 실패하면 알리지 않는다 — 저장되지 않은 일정을 등록됐다고 알리면 안 된다', async () => {
    const { usecase, registerSchedule, notifier } = build();
    registerSchedule.execute.mockRejectedValue(new Error('db down'));

    await expect(usecase.execute(input)).rejects.toThrow('db down');
    expect(notifier.notifyRegistered).not.toHaveBeenCalled();
  });
});
