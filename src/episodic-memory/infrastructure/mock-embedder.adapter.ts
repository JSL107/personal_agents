import { EmbedderPort } from '../domain/port/embedder.port';

// 결정적 의사난수 임베더 — 외부 모델 없이 테스트/임베딩 비활성 환경에서 사용.
// 문자열 해시로 시드 → 차원별 값 생성 → L2 정규화(단위벡터). 의미는 없으나 동일 입력 = 동일 벡터.
export class MockEmbedder implements EmbedderPort {
  constructor(private readonly dimension: number = 384) {}

  // EmbedderPort.embed 의 kind 파라미터는 Mock 에선 무시(의미 없는 결정적 벡터). 구현은 더 적은 파라미터 허용.
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    let seed = 0;
    for (let i = 0; i < text.length; i += 1) {
      seed = (seed * 31 + text.charCodeAt(i)) >>> 0;
    }
    const raw: number[] = [];
    let state = seed || 1;
    for (let i = 0; i < this.dimension; i += 1) {
      state = (state * 1664525 + 1013904223) >>> 0;
      raw.push(state / 0xffffffff - 0.5);
    }
    const norm =
      Math.sqrt(raw.reduce((sum, value) => sum + value * value, 0)) || 1;
    return raw.map((value) => value / norm);
  }
}
