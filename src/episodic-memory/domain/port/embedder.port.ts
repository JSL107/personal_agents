// e5 계열은 'query:'/'passage:' prefix 규약이 있어 kind 로 분기(adapter 가 prefix 부착).
export interface EmbedderPort {
  embed(texts: string[], kind: 'query' | 'passage'): Promise<number[][]>;
}

export const EMBEDDER_PORT = Symbol('EMBEDDER_PORT');
