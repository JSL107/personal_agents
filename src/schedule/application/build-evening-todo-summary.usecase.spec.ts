import { ScheduleSource, ScheduleStatus } from '../domain/schedule.type';
import { buildScheduleItemRecord } from '../domain/schedule-item.fixture';
import { BuildEveningTodoSummaryUsecase } from './build-evening-todo-summary.usecase';

const now = new Date('2026-11-05T10:40:00Z');
const input = {
  ownerId: 'U1',
  kstDate: '2026-11-05',
  now,
  mergedPrCount: 0,
  morningDelivered: true,
};

const item = (
  id: number,
  title: string,
  status: ScheduleStatus,
  overrides: Parameters<typeof buildScheduleItemRecord>[0] = {},
) => buildScheduleItemRecord({ id, title, status, ...overrides });

const createDeps = () => {
  const repository = {
    findCompletedBetween: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue(null),
    findUndated: jest.fn().mockResolvedValue([]),
  };
  const dailyTodoRepository = {
    findForDate: jest.fn().mockResolvedValue(null),
  };
  const resolve = { execute: jest.fn().mockResolvedValue(new Map()) };
  const usecase = new BuildEveningTodoSummaryUsecase(
    repository as never,
    dailyTodoRepository as never,
    resolve as never,
  );
  return { usecase, repository, dailyTodoRepository, resolve };
};

describe('BuildEveningTodoSummaryUsecase', () => {
  it('spec 예시: 3개 중 2개 끝냄 (67%), 남을 기다린 일 2개, 밀린 일 3개 내 차례 1 남 기다림 2 확인 못 함 0', async () => {
    const { usecase, repository, dailyTodoRepository, resolve } = createDeps();
    const records = [
      item(1, '알림 설정 화면 고치기', ScheduleStatus.IN_PROGRESS, {
        createdAt: new Date('2026-11-04T00:00:00Z'),
      }),
      item(2, '학교 관리자 화면', ScheduleStatus.DONE, { completedAt: now }),
      item(3, '작업 현황 정리', ScheduleStatus.DONE, { completedAt: now }),
      item(4, '공지 첨부파일 저장 오류', ScheduleStatus.IN_PROGRESS, {
        createdAt: new Date('2026-10-29T00:00:00Z'),
      }),
      item(5, '상벌점 입장 링크', ScheduleStatus.IN_PROGRESS, {
        createdAt: new Date('2026-10-31T00:00:00Z'),
      }),
    ];
    repository.findCompletedBetween.mockResolvedValue(records.slice(1, 3));
    repository.findById.mockImplementation(async (id: number) =>
      records.find((record) => record.id === id),
    );
    dailyTodoRepository.findForDate.mockResolvedValue({
      status: 'LISTED',
      entries: records.map((record, position) => ({
        scheduleItemId: record.id,
        turn: position < 3 ? 'MY_TURN' : 'WAITING_OTHERS',
        observed: true,
        position,
      })),
    });
    resolve.execute.mockResolvedValue(
      new Map([
        [
          1,
          { turn: 'MY_TURN', reason: '충돌 있음', observed: true, wait: null },
        ],
        [
          4,
          {
            turn: 'WAITING_OTHERS',
            reason: '리뷰 대기',
            observed: true,
            wait: { label: '리뷰 요청 후 3일째 답 없음', days: 3 },
          },
        ],
        [
          5,
          {
            turn: 'WAITING_OTHERS',
            reason: '리뷰 대기',
            observed: true,
            wait: { label: '리뷰 요청 후 2일째 답 없음', days: 2 },
          },
        ],
      ]),
    );

    const result = await usecase.execute(input);

    expect(result.ratio).toEqual({ done: 2, total: 3 });
    expect(result.waiting).toEqual({
      count: 2,
      atLeast: false,
      longest: '리뷰 요청 후 3일째 답 없음',
    });
    expect(result.backlog).toEqual({ myTurn: 1, waiting: 2, unknown: 0 });
    expect(result.done.map((line) => line.title)).toEqual([
      '학교 관리자 화면',
      '작업 현황 정리',
    ]);
    expect(result.notDone.map((line) => line.title)).toEqual([
      '알림 설정 화면 고치기',
      '공지 첨부파일 저장 오류',
      '상벌점 입장 링크',
    ]);
    expect(result.notDone.map((line) => line.detail)).toEqual([
      '2일째, 충돌 있음',
      '8일째, 남 기다림',
      '6일째, 남 기다림',
    ]);
  });

  it('ignores list when morning not delivered', async () => {
    const { usecase, repository, dailyTodoRepository, resolve } = createDeps();
    const done = item(1, '오늘 끝난 일', ScheduleStatus.DONE, {
      completedAt: now,
    });
    const waiting = item(2, '진행 중인 일', ScheduleStatus.IN_PROGRESS);
    repository.findCompletedBetween.mockResolvedValue([done]);
    repository.findUndated.mockResolvedValue([waiting]);
    dailyTodoRepository.findForDate.mockResolvedValue({
      status: 'LISTED',
      entries: [
        { scheduleItemId: 1, turn: 'MY_TURN', observed: true, position: 0 },
      ],
    });
    resolve.execute.mockResolvedValue(
      new Map([
        [
          2,
          { turn: 'WAITING_OTHERS', reason: null, observed: true, wait: null },
        ],
      ]),
    );

    const result = await usecase.execute({ ...input, morningDelivered: false });

    expect(result.hasMorningList).toBe(false);
    expect(result.ratio).toBeNull();
    expect(result.done[0].outsideMorningList).toBe(false);
    expect(result.notDone).toEqual([]);
    expect(result.waiting?.count).toBe(1);
    expect(result.backlog).toEqual({ myTurn: 0, waiting: 1, unknown: 0 });
    expect(dailyTodoRepository.findForDate).not.toHaveBeenCalled();
  });

  it('SKIPPED 와 저장소에서 사라진 업무는 분모에서 빠진다', async () => {
    const { usecase, repository, dailyTodoRepository } = createDeps();
    repository.findById.mockImplementation(async (id: number) =>
      id === 1 ? item(1, '그만둔 일', ScheduleStatus.SKIPPED) : null,
    );
    dailyTodoRepository.findForDate.mockResolvedValue({
      status: 'LISTED',
      entries: [1, 2].map((scheduleItemId, position) => ({
        scheduleItemId,
        turn: 'MY_TURN',
        observed: true,
        position,
      })),
    });

    const result = await usecase.execute(input);

    expect(result.ratio).toBeNull();
    expect(result.notDone).toEqual([]);
  });

  it('waiting line uses 이상 when unobserved', async () => {
    const { usecase, repository, dailyTodoRepository, resolve } = createDeps();
    repository.findById.mockResolvedValue(
      item(1, '대기', ScheduleStatus.IN_PROGRESS),
    );
    dailyTodoRepository.findForDate.mockResolvedValue({
      status: 'LISTED',
      entries: [
        {
          scheduleItemId: 1,
          turn: 'WAITING_OTHERS',
          observed: true,
          position: 0,
        },
      ],
    });
    resolve.execute.mockResolvedValue(
      new Map([
        [
          1,
          { turn: 'WAITING_OTHERS', reason: null, observed: false, wait: null },
        ],
      ]),
    );

    const result = await usecase.execute(input);

    expect(result.waiting).toEqual({ count: 1, atLeast: true, longest: null });
  });

  it('오늘 끝냈다 다시 연 일은 분자에 들지 않는다', async () => {
    const { usecase, repository, dailyTodoRepository } = createDeps();
    repository.findById.mockResolvedValue(
      item(1, '다시 연 일', ScheduleStatus.IN_PROGRESS, { completedAt: now }),
    );
    dailyTodoRepository.findForDate.mockResolvedValue({
      status: 'LISTED',
      entries: [
        { scheduleItemId: 1, turn: 'MY_TURN', observed: true, position: 0 },
      ],
    });

    const result = await usecase.execute(input);

    expect(result.ratio).toEqual({ done: 0, total: 1 });
  });

  it('mergedPrCount 가 저장소 PR 완료 수보다 크면 extraMergedPrCount 에 차이', async () => {
    const { usecase, repository } = createDeps();
    repository.findCompletedBetween.mockResolvedValue([
      item(1, 'PR 완료', ScheduleStatus.DONE, {
        source: ScheduleSource.GITHUB_PR,
        completedAt: now,
      }),
    ]);

    const result = await usecase.execute({ ...input, mergedPrCount: 3 });

    expect(result.extraMergedPrCount).toBe(2);
  });

  it('저장소 조회 실패 시 loadFailed', async () => {
    const { usecase, repository } = createDeps();
    repository.findCompletedBetween.mockRejectedValue(new Error('DB 장애'));

    const result = await usecase.execute(input);

    expect(result.loadFailed).toBe(true);
    expect(result.done).toEqual([]);
  });

  it('23:59 KST 완료는 오늘, 00:01 KST 는 내일', async () => {
    const { usecase, repository } = createDeps();
    const beforeMidnight = item(1, '자정 전', ScheduleStatus.DONE, {
      completedAt: new Date('2026-11-05T14:59:00Z'),
    });
    const afterMidnight = item(2, '자정 후', ScheduleStatus.DONE, {
      completedAt: new Date('2026-11-05T15:01:00Z'),
    });
    repository.findCompletedBetween.mockImplementation(
      async ({ from, to }: { from: Date; to: Date }) =>
        [beforeMidnight, afterMidnight].filter(
          (record) =>
            record.completedAt &&
            record.completedAt >= from &&
            record.completedAt < to,
        ),
    );

    const first = await usecase.execute({ ...input, kstDate: '2026-11-05' });
    const second = await usecase.execute({ ...input, kstDate: '2026-11-06' });

    expect(first.done.map((line) => line.title)).toEqual(['자정 전']);
    expect(second.done.map((line) => line.title)).toEqual(['자정 후']);
  });
});
