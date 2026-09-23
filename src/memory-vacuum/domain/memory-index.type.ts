// 세션 기억 색인(MEMORY.md) 진단·청소 도메인 타입.
//
// 배경: 색인은 세션마다 컨텍스트에 통째로 실리는데 실효 상한이 있다. 넘으면 뒷부분이
// 조용히 잘려, 최근에 쌓은 기억일수록 먼저 보이지 않게 된다. 2026-09-09 실측에서
// personal_agents 색인 49KB/306줄 중 앞 200줄만 로드됐고, 색인에 등록조차 안 된 파일
// 29개를 합쳐 335개 중 135개(40%)가 도달 불가였다.

// 색인 한 줄이 파일 하나를 가리키는 형태: `- [제목](파일.md) — 설명`
export const INDEX_ENTRY_PATTERN =
  /^- \[([^\]]*)\]\(([^)]+\.md)\)(?: — (.*))?$/;

// 묶음 줄이 접두 하나를 통째로 대표한다는 표식: 본문의 `ls project_office_*`.
// 이 표식을 못 읽으면 묶인 파일 전부를 고아로 오판해 색인을 도로 부풀린다.
export const FOLD_MARKER_PATTERN = /`ls ([A-Za-z0-9_]+)\*`/g;

export interface MemoryFile {
  fileName: string; // 'feedback_codex_review.md'
  // frontmatter description 에서 뽑은 한 줄 제목. 고아를 색인에 올릴 때 쓴다.
  title: string;
}

export interface MemoryIndexSnapshot {
  project: string; // 프로젝트 디렉터리명
  indexPath: string;
  indexContent: string; // MEMORY.md 원문 (없으면 빈 문자열)
  // 위성 색인(TOPICS.md) 원문. 색인이 상한에 눌려 주제별 상세 목록을 옆 파일로 뺀
  // 프로젝트가 있다. 그 목록도 엄연한 커버리지라, 이것을 읽지 않으면 거기 등재된
  // 기억 전부가 고아로 판정된다 — 2026-09-20 실측: 50줄 색인에 250줄이 도로 실려
  // 300줄이 됐고, 뒷부분 100줄이 다시 잘렸다. 없으면 빈 문자열.
  satelliteContent: string;
  files: MemoryFile[]; // memory/*.md 중 MEMORY.md 제외
}

// 청소기가 스스로 치울 수 있는 것 = 먼지. 판정이 결정론이고 정보 손실이 없거나 낮다.
export interface MemoryDust {
  orphans: string[]; // 파일은 있는데 색인에 없음 → 존재 자체가 안 보임
  brokenLinks: string[]; // 색인이 가리키는 파일이 없음 → 죽은 줄
  overflowBytes: number; // 상한 초과분. 0 이면 전량 로드된다
}

// 청소기가 못 치우는 것 = 사람 판단이 필요한 묶음 후보.
// 같은 접두를 쓴다고 주제가 같지는 않다(feedback_shared_* 는 DB 스키마·문서 귀속·
// 임시경로·git add 로 제각각이라 묶으면 recall 이 나빠진다). 그래서 제안까지만 한다.
export interface FoldCandidate {
  prefix: string;
  count: number;
}

export interface MemoryDiagnosis {
  project: string;
  indexBytes: number;
  entryCount: number;
  fileCount: number;
  dust: MemoryDust;
  foldCandidates: FoldCandidate[];
}

export type VacuumActionType =
  | 'orphan_indexed' // 고아를 색인에 등록 — 없던 줄 추가라 손실 0
  | 'broken_link_removed' // 파일 없는 줄 제거 — 이미 죽은 줄
  | 'hook_trimmed'; // 색인의 설명 절단 — 파일 본문은 그대로

export interface VacuumAction {
  type: VacuumActionType;
  count: number;
}

export interface VacuumOutcome {
  project: string;
  before: MemoryDiagnosis;
  actions: VacuumAction[];
  // 바꿀 것이 없으면 null — 호출자가 쓰기 자체를 건너뛴다(무의미한 백업·쓰기 방지).
  nextIndexContent: string | null;
  // 청소 뒤 색인의 실제 바이트 수(바뀐 것이 없으면 원래 크기).
  // `before.indexBytes - remainingOverflowBytes` 로 되계산하면 안 된다 — 초과분은
  // 목표를 넘은 몫이지 줄어든 양이 아니라, 목표 밑으로 잘 줄인 회차가 0 이 되어
  // 보고가 `49KB → 49KB`(줄인 것이 없음)로 뒤집힌다.
  nextIndexBytes: number;
  // 청소 후에도 남은 초과분. 0 이 아니면 묶음·폐기가 필요하다는 뜻이라 사람을 부른다.
  remainingOverflowBytes: number;
}
