// 저녁 회고가 "오늘 머지된 PR 전체"를 한 덩어리로 회고에 넘기면, 서로 무관한 작업이 하나의
// 성과로 합쳐진다. 회고 프롬프트는 입력을 "이어진 PR"로 전제하고 "여러 성과로 쪼개지 않는다"를
// 규칙으로 두기 때문에, 전제가 깨진 입력이 오면 모델은 공통점을 찾아 추상화 단계를 올린다
// (실측: 성과 34건 중 14건이 회사·개인 저장소 혼합, 제목에 "조용한 실패" 5회·"관측" 8회 중복).
//
// 묶음 경계를 저장소로 두면 그 전제가 참이 된다. 같은 저장소의 같은 날 작업은 실제로 이어져
// 있고, 다른 저장소는 다른 시스템이다. 포트폴리오 사이트도 같은 경계를 쓴다(project-group.ts).

// 한 그룹이 회고 1회에 들어가는 PR 상한. extractPrReferences 의 MAX_PRS 와 같은 값이어야 한다
// — 그룹을 prText 로 이어 붙여 그 함수에 그대로 넘기므로, 더 크면 뒷부분이 조용히 잘린다.
const MAX_REFS_PER_GROUP = 8;

// 하루에 만드는 그룹 수 상한. 그룹 하나가 모델 호출 1회라 저장소가 흩어진 날 호출이 늘어난다.
// 제외분은 버리지 않고 droppedRefCount 로 드러낸다 (조용한 절삭 금지).
const MAX_GROUPS = 5;

export interface PrRefGroup {
  repo: string;
  refs: string[];
}

export interface GroupedPrRefs {
  groups: PrRefGroup[];
  // 그룹 상한(MAX_GROUPS)·그룹 내 상한(MAX_REFS_PER_GROUP)으로 제외된 PR 수.
  droppedRefCount: number;
}

interface RepoScopedPullRequest {
  repo: string;
  number: number;
}

// 저장소별로 나눈 뒤 PR 이 많은 그룹을 앞에 둔다. 같은 수면 저장소 이름 순 — 회차마다 순서가
// 흔들리면 같은 하루를 두 번 처리할 때 결과가 달라진다.
const compareGroups = (left: PrRefGroup, right: PrRefGroup): number => {
  if (left.refs.length !== right.refs.length) {
    return right.refs.length - left.refs.length;
  }
  return left.repo.localeCompare(right.repo);
};

export const groupPrRefsByRepo = (
  pullRequests: RepoScopedPullRequest[],
): GroupedPrRefs => {
  const byRepo = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const pullRequest of pullRequests) {
    const ref = `${pullRequest.repo}#${pullRequest.number}`;
    if (seen.has(ref)) {
      continue;
    }
    seen.add(ref);
    const refs = byRepo.get(pullRequest.repo) ?? [];
    refs.push(ref);
    byRepo.set(pullRequest.repo, refs);
  }

  let droppedRefCount = 0;
  const groups: PrRefGroup[] = [];
  for (const [repo, refs] of byRepo) {
    if (refs.length > MAX_REFS_PER_GROUP) {
      droppedRefCount += refs.length - MAX_REFS_PER_GROUP;
    }
    groups.push({ repo, refs: refs.slice(0, MAX_REFS_PER_GROUP) });
  }
  groups.sort(compareGroups);

  const kept = groups.slice(0, MAX_GROUPS);
  for (const group of groups.slice(MAX_GROUPS)) {
    droppedRefCount += group.refs.length;
  }
  return { groups: kept, droppedRefCount };
};
