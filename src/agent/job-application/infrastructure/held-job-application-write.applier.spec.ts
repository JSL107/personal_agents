import {
  PREVIEW_KIND,
  PREVIEW_STATUS,
  PreviewAction,
} from '../../../preview-gate/domain/preview-action.type';
import { AddApplicationUsecase } from '../application/add-application.usecase';
import { UpdateApplicationUsecase } from '../application/update-application.usecase';
import { JobApplicationRepositoryPort } from '../domain/port/job-application.repository.port';
import { HeldJobApplicationWriteApplier } from './held-job-application-write.applier';

const date = { year: 2026, month: 11, day: 25 };
const record = {
  id: 8,
  slackUserId: 'U1',
  company: '토스',
  role: '백엔드',
  jdUrl: null,
  status: 'APPLIED' as const,
  appliedAt: date,
  deadline: null,
  nextFollowUpAt: null,
  notes: null,
  createdAt: new Date(),
};
const preview: PreviewAction = {
  id: 'preview-1',
  slackUserId: 'U1',
  kind: PREVIEW_KIND.HELD_JOB_APPLICATION_WRITE,
  payload: {
    sourceRunId: 14,
    action: 'ADD',
    company: '토스',
    role: '백엔드',
    status: 'APPLIED',
    appliedAt: date,
  },
  status: PREVIEW_STATUS.PENDING,
  previewText: '',
  expiresAt: new Date(),
  createdAt: new Date(),
  appliedAt: null,
  cancelledAt: null,
  slackChannelId: null,
  slackMessageTs: null,
  slackThreadTs: null,
  lastFailedAt: null,
  lastFailureReason: null,
  applyProgress: null,
};
const createMocks = () => {
  const repository = {
    listByUser: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<JobApplicationRepositoryPort>;
  const add = {
    execute: jest.fn().mockResolvedValue({ result: record }),
  } as unknown as jest.Mocked<AddApplicationUsecase>;
  const update = {
    executeById: jest
      .fn()
      .mockResolvedValue({ result: { ...record, status: 'SCREENING' } }),
  } as unknown as jest.Mocked<UpdateApplicationUsecase>;
  return { repository, add, update };
};

describe('HeldJobApplicationWriteApplier', () => {
  afterEach(() => jest.useRealTimers());

  it('지원 추가 승인 시 카드 값을 저장하고 단계를 기록한다', async () => {
    const { repository, add, update } = createMocks();
    const progress = {
      done: [],
      record: jest.fn().mockResolvedValue(undefined),
    };
    const result = await new HeldJobApplicationWriteApplier(
      repository,
      add,
      update,
    ).apply(preview, progress);
    expect(add.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        slackUserId: 'U1',
        company: '토스',
        appliedAt: date,
      }),
    );
    expect(progress.record).toHaveBeenCalledWith('job-application-written:8');
    expect(result.message).toContain('지원 등록 완료');
  });

  it('같은 사용자·회사·직무의 비종료 지원이 있으면 다시 추가하지 않는다', async () => {
    const { repository, add, update } = createMocks();
    repository.listByUser.mockResolvedValue([record]);
    const result = await new HeldJobApplicationWriteApplier(
      repository,
      add,
      update,
    ).apply(preview);
    expect(add.execute).not.toHaveBeenCalled();
    expect(result.message).toContain('이미');
  });

  it('같은 날 넣은 같은 지원은 종료 상태여도 다시 추가하지 않는다', async () => {
    const { repository, add, update } = createMocks();
    repository.listByUser.mockResolvedValue([
      { ...record, status: 'REJECTED' },
    ]);
    const result = await new HeldJobApplicationWriteApplier(
      repository,
      add,
      update,
    ).apply(preview);
    expect(add.execute).not.toHaveBeenCalled();
    expect(result.message).toContain('이미');
  });

  it('다른 날 끝난 같은 지원이면 새로 추가한다', async () => {
    const { repository, add, update } = createMocks();
    repository.listByUser.mockResolvedValue([
      {
        ...record,
        status: 'REJECTED',
        appliedAt: { year: 2025, month: 1, day: 2 },
      },
    ]);
    await new HeldJobApplicationWriteApplier(repository, add, update).apply(
      preview,
    );
    expect(add.execute).toHaveBeenCalled();
  });

  it('지원 상태 변경은 카드의 id와 기대 상태를 usecase에 전달한다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-25T00:00:00Z'));
    const { repository, add, update } = createMocks();
    const progress = {
      done: [],
      record: jest.fn().mockResolvedValue(undefined),
    };
    const result = await new HeldJobApplicationWriteApplier(
      repository,
      add,
      update,
    ).apply(
      {
        ...preview,
        payload: {
          sourceRunId: 14,
          action: 'UPDATE_STATUS',
          applicationId: 8,
          expectedStatus: 'APPLIED',
          status: 'SCREENING',
        },
      },
      progress,
    );
    expect(update.executeById).toHaveBeenCalledWith({
      slackUserId: 'U1',
      id: 8,
      expectedStatus: 'APPLIED',
      status: 'SCREENING',
      today: date,
    });
    expect(progress.record).toHaveBeenCalledWith('job-application-written:8');
    expect(result.message).toContain('상태 변경 완료');
  });

  it('카드 생성 뒤 상태가 바뀌면 쓰지 않고 재요청을 안내한다', async () => {
    const { repository, add, update } = createMocks();
    update.executeById.mockResolvedValue({ result: null } as never);
    const result = await new HeldJobApplicationWriteApplier(
      repository,
      add,
      update,
    ).apply({
      ...preview,
      payload: {
        sourceRunId: 14,
        action: 'UPDATE_STATUS',
        applicationId: 8,
        expectedStatus: 'APPLIED',
        status: 'SCREENING',
      },
    });
    expect(result.message).toContain('바뀌었어요');
  });

  it('같은 카드의 완료 단계가 있으면 재승인으로 추가하지 않는다', async () => {
    const { repository, add, update } = createMocks();
    await new HeldJobApplicationWriteApplier(repository, add, update).apply(
      preview,
      {
        done: ['job-application-written:8'],
        record: jest.fn(),
      },
    );
    expect(add.execute).not.toHaveBeenCalled();
  });

  it('잘못된 payload는 쓰기 전에 거절한다', async () => {
    const { repository, add, update } = createMocks();
    await expect(
      new HeldJobApplicationWriteApplier(repository, add, update).apply({
        ...preview,
        payload: {
          sourceRunId: 14,
          action: 'ADD',
          company: '',
          role: '백엔드',
          status: 'APPLIED',
          appliedAt: date,
        },
      }),
    ).rejects.toThrow();
    expect(add.execute).not.toHaveBeenCalled();
  });

  it('웹 주소가 아닌 공고 링크는 쓰기 전에 거절한다', async () => {
    const { repository, add, update } = createMocks();
    await expect(
      new HeldJobApplicationWriteApplier(repository, add, update).apply({
        ...preview,
        payload: {
          sourceRunId: 14,
          action: 'ADD',
          company: '토스',
          role: '백엔드',
          status: 'APPLIED',
          appliedAt: date,
          jdUrl: 'file:///private/secret',
        },
      }),
    ).rejects.toThrow('공고 링크');
    expect(add.execute).not.toHaveBeenCalled();
  });
});
