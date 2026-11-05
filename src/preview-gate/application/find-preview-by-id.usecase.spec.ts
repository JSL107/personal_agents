import { PreviewActionRepositoryPort } from '../domain/port/preview-action.repository.port';
import { PreviewAction } from '../domain/preview-action.type';
import { FindPreviewByIdUsecase } from './find-preview-by-id.usecase';

describe('FindPreviewByIdUsecase', () => {
  it('저장소에서 id 로 카드를 읽는다', async () => {
    const preview = { id: 'card' } as PreviewAction;
    const repository = {
      findById: jest.fn().mockResolvedValue(preview),
    } as unknown as PreviewActionRepositoryPort;

    await expect(
      new FindPreviewByIdUsecase(repository).execute('card'),
    ).resolves.toBe(preview);
    expect(repository.findById).toHaveBeenCalledWith('card');
  });
});
