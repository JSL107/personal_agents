import { GeneratePoOutlineUsecase } from './generate-po-outline.usecase';

describe('GeneratePoOutlineUsecase', () => {
  it('subject 가 비어 있으면 PoExpandException 발생', async () => {
    const usecase = new GeneratePoOutlineUsecase(null as any, null as any);
    await expect(
      usecase.execute({ subject: '   ', slackUserId: 'U1' }),
    ).rejects.toThrow();
  });
});
