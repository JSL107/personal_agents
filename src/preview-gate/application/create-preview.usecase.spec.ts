import { ConsoleEventBus } from '../../console/application/console-event-bus.service';
import { PreviewActionRepositoryPort } from '../domain/port/preview-action.repository.port';
import { PREVIEW_KIND, PreviewAction } from '../domain/preview-action.type';
import { CreatePreviewUsecase } from './create-preview.usecase';

const buildCreated = (): PreviewAction => ({
  id: 'p-1',
  slackUserId: 'U1',
  kind: PREVIEW_KIND.PM_WRITE_BACK,
  payload: {},
  status: 'PENDING',
  previewText: '반영할까요?',
  responseUrl: null,
  expiresAt: new Date('2026-07-27T01:00:00Z'),
  createdAt: new Date('2026-07-27T00:00:00Z'),
  appliedAt: null,
  cancelledAt: null,
  slackChannelId: null,
  slackMessageTs: null,
});

const validInput = {
  slackUserId: 'U1',
  kind: PREVIEW_KIND.PM_WRITE_BACK,
  payload: {},
  previewText: '반영할까요?',
  responseUrl: null,
  ttlMs: 3_600_000,
};

describe('CreatePreviewUsecase', () => {
  it('생성 후 approval.opened 이벤트를 발행한다', async () => {
    const created = buildCreated();
    const repository = {
      create: jest.fn().mockResolvedValue(created),
    } as unknown as jest.Mocked<PreviewActionRepositoryPort>;
    const bus = {
      publish: jest.fn(),
      stream: jest.fn(),
    } as unknown as ConsoleEventBus;
    const usecase = new CreatePreviewUsecase(repository, bus);

    const result = await usecase.execute(validInput);

    expect(result).toBe(created);
    expect(bus.publish).toHaveBeenCalledWith({
      type: 'approval.opened',
      approval: {
        id: 'p-1',
        agentType: null,
        title: '반영할까요?',
        createdAt: '2026-07-27T00:00:00.000Z',
      },
    });
  });

  it('버스 미주입이어도 생성은 정상 동작한다', async () => {
    const created = buildCreated();
    const repository = {
      create: jest.fn().mockResolvedValue(created),
    } as unknown as jest.Mocked<PreviewActionRepositoryPort>;
    const usecase = new CreatePreviewUsecase(repository);

    await expect(usecase.execute(validInput)).resolves.toBe(created);
  });
});
