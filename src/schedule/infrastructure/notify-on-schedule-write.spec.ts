import { ScheduleRepositoryPort } from '../domain/port/schedule.repository.port';
import { notifyOnScheduleWrite } from './notify-on-schedule-write';

describe('notifyOnScheduleWrite', () => {
  const build = (
    overrides: Partial<Record<keyof ScheduleRepositoryPort, jest.Mock>>,
  ) => {
    const repository = overrides as unknown as ScheduleRepositoryPort;
    const onChanged = jest.fn();
    return {
      wrapped: notifyOnScheduleWrite({ repository, onChanged }),
      onChanged,
    };
  };

  it('쓰기가 성공하면 알리고 결과를 그대로 돌려준다', async () => {
    const saved = { id: 1 };
    const { wrapped, onChanged } = build({
      save: jest.fn().mockResolvedValue(saved),
    });

    const result = await wrapped.save({} as never);

    expect(result).toBe(saved);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('반환값이 없는 쓰기(삭제)도 알린다', async () => {
    const { wrapped, onChanged } = build({
      deleteById: jest.fn().mockResolvedValue(undefined),
    });

    await wrapped.deleteById(1);

    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('읽기는 알리지 않는다', async () => {
    const { wrapped, onChanged } = build({
      findById: jest.fn().mockResolvedValue({ id: 1 }),
    });

    await wrapped.findById(1);

    expect(onChanged).not.toHaveBeenCalled();
  });

  it.each([
    ['빈 선점', 'claimDueReminders', []],
    ['갱신 0건', 'expireCandidates', 0],
    ['대상 없음', 'transition', null],
    ['반영 안 됨', 'markReminded', false],
    ['중복 이벤트', 'addEvent', 'DUPLICATE'],
  ] as const)(
    '바뀐 것이 없는 쓰기(%s)는 알리지 않는다',
    async (_label, name, value) => {
      const { wrapped, onChanged } = build({
        [name]: jest.fn().mockResolvedValue(value),
      });

      await (wrapped[name] as (input: never) => Promise<unknown>)({} as never);

      expect(onChanged).not.toHaveBeenCalled();
    },
  );

  it('쓰기가 실패하면 알리지 않고 오류를 그대로 던진다', async () => {
    const failure = new Error('db down');
    const { wrapped, onChanged } = build({
      updateFields: jest.fn().mockRejectedValue(failure),
    });

    await expect(wrapped.updateFields({} as never)).rejects.toBe(failure);
    expect(onChanged).not.toHaveBeenCalled();
  });
});
