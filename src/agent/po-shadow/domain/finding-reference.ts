import { PlanRealityFact } from './plan-reality.diff';
import { PoShadowFinding, PoShadowFindingReference } from './po-shadow.type';

// 지적 한 줄이 "무슨 일" 인지 알려면 어느 저장소의 어떤 항목인지, 눌러서 볼 수 있는지가 필요하다.
// 모델은 "#3922 학교 관리자용" 처럼 줄여 쓰므로, 인용한 사실에서 저장소·번호·원래 제목·링크를
// 코드가 다시 꺼내 붙인다 — 모델 출력에 기대지 않아 지어낸 링크가 나갈 수 없다.

// 한 지적 아래 링크가 길게 늘어서지 않게 자른다. 나머지는 근거 스레드에 있다.
const MAX_REFERENCES_PER_FINDING = 3;

// fact id 는 `<kind>:<owner/repo#N>` 형태가 GitHub 항목이다(멘션·실패 실행·Notion 은 다른 꼴).
const GITHUB_KEY = /^[^:]+:([\w.-]+\/[\w.-]+#\d+)$/;

const toRepoNumber = (key: string): string => key.slice(key.indexOf('/') + 1);

interface KeyedReference {
  // 같은 항목을 가리키는지 가르는 값. GitHub 항목은 `owner/repo#N`, 나머지는 fact id.
  identity: string;
  reference: PoShadowFindingReference;
}

const toReference = (
  fact: PlanRealityFact,
  titleByKey: Map<string, string>,
): KeyedReference => {
  const key = GITHUB_KEY.exec(fact.id)?.[1];
  if (!key) {
    return {
      identity: fact.id,
      reference: { text: fact.label, url: fact.url ?? null },
    };
  }
  const repoNumber = toRepoNumber(key);
  // 이번 회차 조회 결과의 원래 제목을 먼저 쓴다 — 사실표 label 은 길이 제한으로 잘려 있고,
  // 지난 지적에서 온 사실은 label 이 `repo#N` 뿐이라 제목이 아예 없다.
  const title =
    titleByKey.get(key) ?? (fact.label === repoNumber ? null : fact.label);
  return {
    identity: key,
    reference: {
      text: title ? `${repoNumber} ${title}` : repoNumber,
      url: fact.url ?? null,
    },
  };
};

export const buildFindingReferences = (
  findings: PoShadowFinding[],
  facts: PlanRealityFact[],
  titleByKey: Map<string, string>,
): PoShadowFindingReference[][] => {
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  return findings.map((finding) => {
    const references = [...new Set(finding.factIds)]
      .map((factId) => factById.get(factId))
      .filter((fact): fact is PlanRealityFact => fact !== undefined)
      .map((fact) => toReference(fact, titleByKey));
    // 같은 항목을 가리키는 사실(예: 계획 대조 + 지난 지적)이 겹치면 한 번만 적는다. 표시 문구는
    // 사실마다 달라(제목 유무) 문구가 아니라 항목 키로 가른다. 먼저 인용한 쪽을 남긴다.
    const unique = new Map<string, PoShadowFindingReference>();
    for (const { identity, reference } of references) {
      if (!unique.has(identity)) {
        unique.set(identity, reference);
      }
    }
    return [...unique.values()].slice(0, MAX_REFERENCES_PER_FINDING);
  });
};
