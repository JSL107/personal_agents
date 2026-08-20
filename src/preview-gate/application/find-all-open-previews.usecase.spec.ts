import { PreviewActionRepositoryPort } from '../domain/port/preview-action.repository.port';
import { FindAllOpenPreviewsUsecase } from './find-all-open-previews.usecase';

describe('FindAllOpenPreviewsUsecase', () => {
  it('repository.findAllOpen 에 now 를 전달하고 결과를 그대로 반환한다', async () => {
    const rows = [{ id: 'p-1' }];
    const repository = {
      findAllOpen: jest.fn().mockResolvedValue(rows),
      findAllDayOutcomes: jest.fn().mockResolvedValue([]),
      countByPayloadValue: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<PreviewActionRepositoryPort>;
    const usecase = new FindAllOpenPreviewsUsecase(repository);
    const now = new Date('2026-07-27T00:00:00Z');

    const result = await usecase.execute({ now });

    expect(repository.findAllOpen).toHaveBeenCalledWith({ now });
    expect(result).toBe(rows);
  });

  it('now 미지정 시 현재 시각(Date)으로 조회한다', async () => {
    const repository = {
      findAllOpen: jest.fn().mockResolvedValue([]),
      countByPayloadValue: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<PreviewActionRepositoryPort>;
    const usecase = new FindAllOpenPreviewsUsecase(repository);

    await usecase.execute({});

    expect(repository.findAllOpen).toHaveBeenCalledTimes(1);
    expect(repository.findAllOpen.mock.calls[0][0].now).toBeInstanceOf(Date);
  });
});
