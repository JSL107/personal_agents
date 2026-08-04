import { PreviewActionRepositoryPort } from '../domain/port/preview-action.repository.port';
import { CountPreviewsByPayloadUsecase } from './count-previews-by-payload.usecase';

describe('CountPreviewsByPayloadUsecase', () => {
  it('payload 조회 조건을 repository에 위임하고 count를 반환한다', async () => {
    const repository = {
      countByPayloadValue: jest.fn().mockResolvedValue(3),
    } as unknown as jest.Mocked<PreviewActionRepositoryPort>;
    const usecase = new CountPreviewsByPayloadUsecase(repository);
    const input = {
      kind: 'SESSION_INJECT',
      payloadPath: ['prRef'],
      payloadValue: 'me/repo#7',
    };

    const result = await usecase.execute(input);

    expect(result).toBe(3);
    expect(repository.countByPayloadValue).toHaveBeenCalledWith(input);
  });
});
