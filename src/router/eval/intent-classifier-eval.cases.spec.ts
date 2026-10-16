import { WORKER_CAPABILITIES } from '../domain/worker-capability';
import { INTENT_CLASSIFIER_EVAL_CASES } from './intent-classifier-eval.cases';

describe('INTENT_CLASSIFIER_EVAL_CASES', () => {
  const candidates = new Set<string>([
    ...WORKER_CAPABILITIES.map(({ agentType }) => agentType),
    'UNKNOWN',
  ]);

  it('문항 id 가 겹치지 않는다', () => {
    const ids = INTENT_CLASSIFIER_EVAL_CASES.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('정답은 분류 후보 안에 있다 — 후보에서 빠진 워커를 정답으로 두면 그 문항은 영영 틀린다', () => {
    for (const evalCase of INTENT_CLASSIFIER_EVAL_CASES) {
      expect(evalCase.accept.length).toBeGreaterThan(0);
      for (const accepted of evalCase.accept) {
        expect(candidates).toContain(accepted);
      }
    }
  });

  // 새 워커를 분류 후보에 넣고 문항을 빠뜨리면 여기서 실패한다. 그 워커가 남의 문장을 빼앗는지(#852)는
  // 문항이 있어야 잴 수 있다.
  it('분류 후보 워커마다 정답 문항이 하나 이상 있다', () => {
    const covered = new Set(
      INTENT_CLASSIFIER_EVAL_CASES.flatMap(({ accept }) => accept),
    );
    const missing = [...candidates].filter(
      (candidate) => !covered.has(candidate as never),
    );
    expect(missing).toEqual([]);
  });
});
