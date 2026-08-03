export type ResolutionVerdict = 'FIXED' | 'NOT_FIXED' | 'UNCLEAR';

export interface FindingResolutionItem {
  id: number;
  body: string;
  filePath: string;
  line: number;
  // 카드 게시 시점(headSha) 이후 그 파일에 일어난 변경 조각. 전체 diff 가 아니라
  // 지적한 줄 근처만 잘라 넣는다 — 프롬프트가 커지면 판정이 흐려진다.
  changedDiff: string;
}

export interface JudgeFindingResolutionInput {
  items: FindingResolutionItem[];
}

export interface FindingResolutionJudgment {
  id: number;
  verdict: ResolutionVerdict;
  reason: string;
}
