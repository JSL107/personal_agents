import { ModelProviderName } from '../domain/model-router.type';
import { MockModelProvider } from './mock-model.provider';

describe('MockModelProvider', () => {
  it('전달받은 name 을 응답의 provider 로 반환한다', async () => {
    const provider = new MockModelProvider(ModelProviderName.CLAUDE);

    const result = await provider.complete({ prompt: 'hello' });

    expect(result.provider).toBe(ModelProviderName.CLAUDE);
    expect(result.modelUsed).toBe('mock-claude');
    expect(result.text).toContain('hello');
  });
});
