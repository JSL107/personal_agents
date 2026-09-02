import { CareerProfileData } from './career-mate.type';
import { evidenceKey } from './evidence-key';

// 사람이 승인 카드에 직접 적은 맥락(impactContext)을 프로필을 다시 쓸 때 지켜낸다.
//
// 프로필을 통째로 갈아 끼우는 경로가 둘이다. REFLECT_PR 은 같은 PR 의 성과를 새 것으로 교체하고
// (merge-accomplishment.ts), BUILD_PROFILE 은 이전 프로필을 읽지도 않고 모델 출력으로 전체를
// 덮는다. 둘 다 성과 본문은 모델이 다시 만들어 주지만, 맥락만은 못 만든다 — 코드에 없는 정보라
// 애초에 그걸 받으려고 만든 기능이다.
//
// 그대로 두면 같은 PR 을 맥락 없이 한 번 더 회고하거나 프로필을 다시 만드는 순간, 사람이 적은
// 문장만 조용히 사라진다. 몇 달 뒤 이력서를 열었을 때 그 문장은 어디에도 없고, 기억도 이미 흐려져
// 있다. 새 맥락이 들어온 자리는 새 값이 이기고, 비어 있는 자리만 옛 값으로 채운다.
//
// 짝을 못 찾은 옛 성과는 그냥 지나간다 — BUILD_PROFILE 이 성과를 다시 묶으면 키가 달라질 수 있고,
// 그때 아무 성과에나 남의 맥락을 붙이는 편이 잃는 것보다 나쁘다.
export const preserveImpactContexts = ({
  previous,
  next,
}: {
  previous: CareerProfileData | null;
  next: CareerProfileData;
}): CareerProfileData => {
  if (!previous) {
    return next;
  }
  const kept = new Map<string, string>();
  for (const accomplishment of previous.accomplishments) {
    const context = accomplishment.impactContext?.trim();
    const key = evidenceKey(accomplishment);
    if (context && key) {
      kept.set(key, context);
    }
  }
  if (kept.size === 0) {
    return next;
  }
  return {
    ...next,
    accomplishments: next.accomplishments.map((accomplishment) => {
      if (accomplishment.impactContext?.trim()) {
        return accomplishment;
      }
      const carried = kept.get(evidenceKey(accomplishment));
      return carried
        ? { ...accomplishment, impactContext: carried }
        : accomplishment;
    }),
  };
};
