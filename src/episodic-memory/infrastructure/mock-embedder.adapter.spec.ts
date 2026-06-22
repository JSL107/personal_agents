import { MockEmbedder } from './mock-embedder.adapter';

describe('MockEmbedder', () => {
  it('384차원 단위벡터를 입력별로 결정적으로 반환한다', async () => {
    const embedder = new MockEmbedder(384);
    const [a1] = await embedder.embed(['hello']);
    const [a2] = await embedder.embed(['hello']);
    const [b1] = await embedder.embed(['world']);

    expect(a1).toHaveLength(384);
    expect(a1).toEqual(a2); // 결정적
    expect(a1).not.toEqual(b1); // 입력 다르면 다름
    const norm = Math.sqrt(a1.reduce((sum, value) => sum + value * value, 0));
    expect(norm).toBeCloseTo(1, 5); // 단위벡터
  });
});
