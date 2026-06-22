// LocalEmbedder 실증 smoke test — transformers.js ESM dynamic import + 한국어 임베딩 동작 확인.
// 실행: pnpm exec ts-node scripts/episodic-smoke.ts (첫 실행 시 모델 다운로드 수십초)
import { LocalEmbedder } from '../src/episodic-memory/infrastructure/local-embedder.adapter';

async function main(): Promise<void> {
  const embedder = new LocalEmbedder('Xenova/multilingual-e5-small');
  const [passage] = await embedder.embed(['결제 모듈 리팩토링 계획'], 'passage');
  const [near] = await embedder.embed(['결제 코드 개선 작업'], 'query');
  const [far] = await embedder.embed(['점심 메뉴 추천'], 'query');

  const cosine = (a: number[], b: number[]): number =>
    a.reduce((sum, value, index) => sum + value * b[index], 0);

  console.log('passage dim:', passage.length);
  console.log('near query dim:', near.length);
  console.log('cosine(결제 plan ↔ 결제 개선):', cosine(passage, near).toFixed(4));
  console.log('cosine(결제 plan ↔ 점심 메뉴):', cosine(passage, far).toFixed(4));

  if (passage.length !== 384) {
    throw new Error(`기대 차원 384, 실제 ${passage.length}`);
  }
  if (cosine(passage, near) <= cosine(passage, far)) {
    throw new Error('의미 유사도 역전 — 관련 문장이 무관 문장보다 가깝지 않음');
  }
  console.log('SMOKE OK — ESM 로드 + 384dim + 의미 유사도 정상');
}

main().catch((error) => {
  console.error('SMOKE FAIL:', error);
  process.exit(1);
});
