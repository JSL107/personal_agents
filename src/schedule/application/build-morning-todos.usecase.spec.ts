import { ScheduleSource, ScheduleStatus } from '../domain/schedule.type';
import { buildScheduleItemRecord } from '../domain/schedule-item.fixture';
import { BuildMorningTodosUsecase } from './build-morning-todos.usecase';

const now = new Date('2026-11-09T00:00:00Z');
const input = { ownerId: 'U1', kstDate: '2026-11-09', now };

const createDeps = () => {
  const reconcile = { execute: jest.fn().mockResolvedValue({ ok: true }) };
  const resolve = { execute: jest.fn().mockResolvedValue(new Map()) };
  const repository = { findUndated: jest.fn().mockResolvedValue([]) };
  const dailyTodoRepository = {
    replaceForDate: jest.fn().mockResolvedValue(undefined),
    findForDate: jest.fn().mockResolvedValue(null),
  };
  const usecase = new BuildMorningTodosUsecase(
    reconcile as never,
    resolve as never,
    repository as never,
    dailyTodoRepository as never,
  );
  return { usecase, reconcile, resolve, repository, dailyTodoRepository };
};

describe('BuildMorningTodosUsecase', () => {
  it('이미 발송한 날의 목록이 있으면 재실행이 목록을 덮어쓰지 않는다', async () => {
    const { usecase, dailyTodoRepository } = createDeps();
    dailyTodoRepository.findForDate.mockResolvedValue({
      status: 'LISTED',
      entries: [
        { scheduleItemId: 7, turn: 'MY_TURN', observed: true, position: 0 },
      ],
    });

    await usecase.execute({ ...input, alreadyDelivered: true });

    expect(dailyTodoRepository.findForDate).toHaveBeenCalledWith({
      slackUserId: 'U1',
      kstDate: '2026-11-09',
    });
    expect(dailyTodoRepository.replaceForDate).not.toHaveBeenCalled();
  });

  it('reconciles merged PRs before listing', async () => {
    const { usecase, reconcile, repository } = createDeps();
    const merged = buildScheduleItemRecord({
      id: 7,
      title: '금요일 밤 머지한 PR',
      source: ScheduleSource.GITHUB_PR,
      status: ScheduleStatus.IN_PROGRESS,
    });
    reconcile.execute.mockImplementation(async () => {
      merged.status = ScheduleStatus.DONE;
      return { ok: true };
    });
    repository.findUndated.mockImplementation(async () =>
      merged.status === ScheduleStatus.DONE ? [] : [merged],
    );

    const result = await usecase.execute(input);

    expect(reconcile.execute).toHaveBeenCalledWith({ ownerId: 'U1', now });
    expect(repository.findUndated).toHaveBeenCalledWith('U1');
    expect(result.today).toEqual([]);
    expect(result.waiting).toEqual([]);
  });

  it('정합 실패여도 조회를 이어가고 진행 중만 목록에 넣으며 OPEN은 unstarted로 둔다', async () => {
    const { usecase, reconcile, repository, resolve } = createDeps();
    reconcile.execute.mockRejectedValue(new Error('GitHub 장애'));
    repository.findUndated.mockResolvedValue([
      buildScheduleItemRecord({
        id: 1,
        title: '진행 중',
        status: ScheduleStatus.IN_PROGRESS,
      }),
      buildScheduleItemRecord({
        id: 2,
        title: '시작 전',
        status: ScheduleStatus.OPEN,
      }),
      buildScheduleItemRecord({ id: 3, status: ScheduleStatus.CANDIDATE }),
      buildScheduleItemRecord({
        id: 4,
        status: ScheduleStatus.IN_PROGRESS,
        isHoliday: true,
      }),
      buildScheduleItemRecord({ id: 5, status: ScheduleStatus.DONE }),
      buildScheduleItemRecord({
        id: 6,
        status: ScheduleStatus.IN_PROGRESS,
        dueDate: new Date('2026-11-09'),
      }),
    ]);
    resolve.execute.mockResolvedValue(
      new Map([
        [1, { turn: 'UNKNOWN', reason: null, observed: false, wait: null }],
      ]),
    );

    const result = await usecase.execute(input);

    expect(result.today.map((line) => line.title)).toEqual(['진행 중']);
    expect(result.unstarted.map((line) => line.title)).toEqual(['시작 전']);
    expect(result.waiting).toEqual([]);
  });

  it('MY_TURN 먼저, 각 차례 안에서 일수 내림차순과 id 오름차순으로 정렬한다', async () => {
    const { usecase, repository, resolve } = createDeps();
    repository.findUndated.mockResolvedValue([
      buildScheduleItemRecord({
        id: 4,
        title: '확인 못 한 오래된 일',
        status: ScheduleStatus.IN_PROGRESS,
        createdAt: new Date('2026-11-04T00:00:00Z'),
      }),
      buildScheduleItemRecord({
        id: 3,
        title: '내 차례 늦은 번호',
        status: ScheduleStatus.IN_PROGRESS,
        createdAt: new Date('2026-11-05T00:00:00Z'),
      }),
      buildScheduleItemRecord({
        id: 2,
        title: '내 차례 빠른 번호',
        status: ScheduleStatus.IN_PROGRESS,
        createdAt: new Date('2026-11-05T00:00:00Z'),
      }),
      buildScheduleItemRecord({
        id: 1,
        title: '내 차례 최근 일',
        status: ScheduleStatus.IN_PROGRESS,
        createdAt: new Date('2026-11-09T00:00:00Z'),
      }),
    ]);
    resolve.execute.mockResolvedValue(
      new Map([
        [4, { turn: 'UNKNOWN', reason: null, observed: false, wait: null }],
        [3, { turn: 'MY_TURN', reason: '승인됨', observed: true, wait: null }],
        [
          2,
          { turn: 'MY_TURN', reason: '충돌 있음', observed: true, wait: null },
        ],
        [1, { turn: 'MY_TURN', reason: null, observed: true, wait: null }],
      ]),
    );

    const result = await usecase.execute(input);

    expect(result.today.map((line) => line.title)).toEqual([
      '내 차례 빠른 번호',
      '내 차례 늦은 번호',
      '내 차례 최근 일',
      '확인 못 한 오래된 일',
    ]);
    expect(result.today.map((line) => line.dayCount)).toEqual([5, 5, 1, 6]);
    expect(result.today.map((line) => line.detail)).toEqual([
      '충돌 있음',
      '승인됨',
      null,
      null,
    ]);
  });

  it('ownerId가 null이면 loadFailed이며 조회와 저장을 하지 않는다', async () => {
    const { usecase, reconcile, repository, dailyTodoRepository } =
      createDeps();

    const result = await usecase.execute({ ...input, ownerId: null });

    expect(result.loadFailed).toBe(true);
    expect(repository.findUndated).not.toHaveBeenCalled();
    expect(reconcile.execute).not.toHaveBeenCalled();
    expect(dailyTodoRepository.replaceForDate).not.toHaveBeenCalled();
  });

  it('저장소 조회에 실패하면 LOAD_FAILED 헤더를 저장한다', async () => {
    const { usecase, repository, dailyTodoRepository } = createDeps();
    repository.findUndated.mockRejectedValue(new Error('저장소 장애'));

    const result = await usecase.execute(input);

    expect(result.loadFailed).toBe(true);
    expect(dailyTodoRepository.replaceForDate).toHaveBeenCalledWith({
      slackUserId: 'U1',
      kstDate: '2026-11-09',
      status: 'LOAD_FAILED',
      entries: [],
    });
  });

  it('조회 성공 0건이면 EMPTY 헤더를 저장한다', async () => {
    const { usecase, dailyTodoRepository } = createDeps();

    const result = await usecase.execute(input);

    expect(result.loadFailed).toBe(false);
    expect(result.today).toEqual([]);
    expect(dailyTodoRepository.replaceForDate).toHaveBeenCalledWith({
      slackUserId: 'U1',
      kstDate: '2026-11-09',
      status: 'EMPTY',
      entries: [],
    });
  });

  it('waiting을 포함한 IN_PROGRESS 전부 저장하고 unstarted는 저장하지 않는다', async () => {
    const { usecase, repository, resolve, dailyTodoRepository } = createDeps();
    repository.findUndated.mockResolvedValue([
      buildScheduleItemRecord({
        id: 1,
        title: '내 차례',
        status: ScheduleStatus.IN_PROGRESS,
      }),
      buildScheduleItemRecord({
        id: 2,
        title: '남 기다림',
        status: ScheduleStatus.IN_PROGRESS,
      }),
      buildScheduleItemRecord({
        id: 3,
        title: '확인 못 함',
        status: ScheduleStatus.IN_PROGRESS,
      }),
      buildScheduleItemRecord({
        id: 4,
        title: '시작 전',
        status: ScheduleStatus.OPEN,
      }),
    ]);
    resolve.execute.mockResolvedValue(
      new Map([
        [1, { turn: 'MY_TURN', reason: null, observed: true, wait: null }],
        [
          2,
          {
            turn: 'WAITING_OTHERS',
            reason: '리뷰 대기',
            observed: true,
            wait: { label: '리뷰 대기', days: null },
          },
        ],
        [3, { turn: 'UNKNOWN', reason: null, observed: false, wait: null }],
      ]),
    );

    const result = await usecase.execute(input);

    expect(result.today).toHaveLength(2);
    expect(result.waiting).toHaveLength(1);
    expect(result.unstarted).toHaveLength(1);
    expect(dailyTodoRepository.replaceForDate).toHaveBeenCalledWith({
      slackUserId: 'U1',
      kstDate: '2026-11-09',
      status: 'LISTED',
      entries: [
        { scheduleItemId: 1, turn: 'MY_TURN', observed: true, position: 0 },
        { scheduleItemId: 3, turn: 'UNKNOWN', observed: false, position: 1 },
        {
          scheduleItemId: 2,
          turn: 'WAITING_OTHERS',
          observed: true,
          position: 2,
        },
      ],
    });
  });

  it('waiting은 일수 내림차순과 id 오름차순으로 정렬한다', async () => {
    const { usecase, repository, resolve } = createDeps();
    repository.findUndated.mockResolvedValue([
      buildScheduleItemRecord({
        id: 3,
        title: '최근',
        status: ScheduleStatus.IN_PROGRESS,
        createdAt: new Date('2026-11-09T00:00:00Z'),
      }),
      buildScheduleItemRecord({
        id: 2,
        title: '오래된 뒤 번호',
        status: ScheduleStatus.IN_PROGRESS,
        createdAt: new Date('2026-11-05T00:00:00Z'),
      }),
      buildScheduleItemRecord({
        id: 1,
        title: '오래된 앞 번호',
        status: ScheduleStatus.IN_PROGRESS,
        createdAt: new Date('2026-11-05T00:00:00Z'),
      }),
    ]);
    resolve.execute.mockResolvedValue(
      new Map(
        [1, 2, 3].map((id) => [
          id,
          {
            turn: 'WAITING_OTHERS',
            reason: '리뷰 대기',
            observed: true,
            wait: { label: '리뷰 대기', days: null },
          },
        ]),
      ),
    );

    const result = await usecase.execute(input);

    expect(result.waiting.map((line) => line.title)).toEqual([
      '오래된 앞 번호',
      '오래된 뒤 번호',
      '최근',
    ]);
  });

  // 저장 실패는 저녁만 「아침 목록 없음」으로 다루고, 아침에는 만든 목록을 그대로 보여 준다.
  it('목록 저장이 실패해도 만든 목록은 그대로 돌려준다', async () => {
    const { usecase, dailyTodoRepository } = createDeps();
    dailyTodoRepository.replaceForDate.mockRejectedValue(
      new Error('저장 실패'),
    );

    const result = await usecase.execute(input);

    expect(result.loadFailed).toBe(false);
  });
});
