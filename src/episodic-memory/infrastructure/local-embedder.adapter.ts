import { Logger } from '@nestjs/common';

import { EmbedderPort } from '../domain/port/embedder.port';

// tsc(commonjs)가 import() 를 require 로 다운레벨하지 못하도록 Function 으로 감싼 진짜 ESM dynamic import.
// @huggingface/transformers 는 ESM-only 라 require 로 로드하면 ERR_REQUIRE_ESM 발생.
const importEsm = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<unknown>;

interface FeatureExtractionPipeline {
  (
    texts: string[],
    options: { pooling: 'mean'; normalize: boolean },
  ): Promise<{ tolist(): number[][] }>;
}

interface TransformersModule {
  pipeline(
    task: 'feature-extraction',
    model: string,
  ): Promise<FeatureExtractionPipeline>;
}

// transformers.js 로컬 임베더. e5 규약: 저장 텍스트는 'passage: ', 쿼리는 'query: ' prefix.
// 모델은 첫 호출 시 lazy load(부팅 지연 0) — 이후 캐시.
export class LocalEmbedder implements EmbedderPort {
  private readonly logger = new Logger(LocalEmbedder.name);
  private pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

  constructor(private readonly modelId: string) {}

  async embed(texts: string[], kind: 'query' | 'passage'): Promise<number[][]> {
    const pipeline = await this.loadPipeline();
    const prefix = kind === 'query' ? 'query: ' : 'passage: ';
    const prefixed = texts.map((text) => `${prefix}${text}`);
    const output = await pipeline(prefixed, {
      pooling: 'mean',
      normalize: true,
    });
    return output.tolist();
  }

  private async loadPipeline(): Promise<FeatureExtractionPipeline> {
    if (!this.pipelinePromise) {
      this.pipelinePromise = (async () => {
        this.logger.log(`LocalEmbedder — 모델 로드 시작: ${this.modelId}`);
        const mod = (await importEsm(
          '@huggingface/transformers',
        )) as TransformersModule;
        const extractor = await mod.pipeline(
          'feature-extraction',
          this.modelId,
        );
        this.logger.log(`LocalEmbedder — 모델 로드 완료: ${this.modelId}`);
        return extractor;
      })();
    }
    return await this.pipelinePromise;
  }
}
