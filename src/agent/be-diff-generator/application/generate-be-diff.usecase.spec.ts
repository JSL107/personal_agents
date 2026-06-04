import { ModelProviderName } from '../../../model-router/domain/model-router.type';
import { ModelProviderPort } from '../../../model-router/domain/port/model-provider.port';
import { BeDiffGeneratorException } from '../domain/be-diff-generator.exception';
import { BeDiffGeneratorErrorCode } from '../domain/be-diff-generator-error-code.enum';
import { GenerateBeDiffUsecase } from './generate-be-diff.usecase';

const validResponse = JSON.stringify({
  diff: `--- a/src/foo/foo.ts
+++ b/src/foo/foo.ts
@@ -1,3 +1,4 @@
 export const foo = () => {
-  return 1;
+  return 2;
+  // doubled
 };`,
  reasoning: 'foo 반환을 2로 변경',
  changedFiles: ['src/foo/foo.ts'],
});

describe('GenerateBeDiffUsecase', () => {
  const claudeProvider: jest.Mocked<ModelProviderPort> = {
    name: ModelProviderName.CLAUDE,
    complete: jest.fn(),
  };

  const usecase = new GenerateBeDiffUsecase(claudeProvider);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('planText 비어 있으면 EMPTY_PLAN 예외', async () => {
    await expect(
      usecase.execute({
        planText: '   ',
        repoLabel: 'foo/bar',
        baseBranch: 'main',
      }),
    ).rejects.toMatchObject({
      beDiffGeneratorErrorCode: BeDiffGeneratorErrorCode.EMPTY_PLAN,
    });
    expect(claudeProvider.complete).not.toHaveBeenCalled();
  });

  it('정상 plan → claude 호출 + parsed BeDiffGenerationResult 반환', async () => {
    claudeProvider.complete.mockResolvedValue({
      text: validResponse,
      modelUsed: 'claude-cli',
      provider: ModelProviderName.CLAUDE,
    });

    const result = await usecase.execute({
      planText: 'foo 함수 반환값 2로',
      repoLabel: 'JSL107/personal_agents',
      baseBranch: 'main',
    });

    expect(claudeProvider.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('foo 함수 반환값 2로'),
        systemPrompt: expect.stringContaining('unified diff'),
      }),
    );
    expect(result.changedFiles).toEqual(['src/foo/foo.ts']);
    expect(result.diff).toContain('@@ -1,3 +1,4 @@');
  });

  it('claude 응답이 invalid JSON → parser 가 INVALID_MODEL_OUTPUT throw', async () => {
    claudeProvider.complete.mockResolvedValue({
      text: 'not json',
      modelUsed: 'claude-cli',
      provider: ModelProviderName.CLAUDE,
    });
    await expect(
      usecase.execute({
        planText: 'p',
        repoLabel: 'r',
        baseBranch: 'main',
      }),
    ).rejects.toBeInstanceOf(BeDiffGeneratorException);
  });

  it('plan 본문이 너무 길면 cap 적용 (생략 표시 부착)', async () => {
    claudeProvider.complete.mockResolvedValue({
      text: validResponse,
      modelUsed: 'claude-cli',
      provider: ModelProviderName.CLAUDE,
    });
    const huge = 'A'.repeat(10_000);
    await usecase.execute({
      planText: huge,
      repoLabel: 'r',
      baseBranch: 'main',
    });
    const calledPrompt = claudeProvider.complete.mock.calls[0][0].prompt;
    expect(calledPrompt).toContain('생략됨');
    expect(calledPrompt.length).toBeLessThan(11_000);
  });
});
