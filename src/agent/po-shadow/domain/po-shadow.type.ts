import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { FailedRunDetail } from '../../../agent-run/domain/port/agent-run.repository.port';
import {
  AssignedTasks,
  GithubPullRequest,
  GithubPullRequestSummary,
} from '../../../github/domain/github.type';
import { WaitingItem } from '../../../github/domain/pr-engagement.type';
import { NotionTask } from '../../../notion/domain/notion.type';
import { SlackMention } from '../../../slack-collector/domain/slack-collector.type';

export interface PoShadowContext {
  assignedTasks: AssignedTasks | null;
  waitingItems: WaitingItem[];
  activePullRequests: GithubPullRequest[];
  // 계획 수립 이후 머지된 본인 PR. 담당 목록은 open 만 반환하므로, 이게 없으면
  // "오전에 계획대로 끝낸 항목" 이 담당 목록에서 사라졌다는 이유로 미확인 취급된다.
  mergedPullRequests: GithubPullRequestSummary[];
  newMentions: SlackMention[];
  notionTasks: NotionTask[];
  failedRunsToday: FailedRunDetail[];
  // 수집에 실패한 소스의 한국어 라벨. 빈 배열이면 5개 소스를 모두 실제로 조회했다는 뜻이다.
  // 조회가 죽은 회차와 진짜 평온한 회차는 글자가 같으면 안 된다.
  degradedSources: string[];
}

// /po-shadow 입력: 직전 PM `/today` 결과 위에 얹어서 PO 시각으로 재검토.
// extraContext 는 사용자가 추가로 주는 상황 (예: "v1.2 릴리즈 직전").
export interface GeneratePoShadowInput {
  extraContext: string;
  slackUserId: string;
  triggerType?: TriggerType;
  enforcePlanFreshness?: boolean;
}

export interface PoShadowFinding {
  factIds: string[];
  point: string;
  suggestion: string;
}

export interface PoShadowReport {
  schemaVersion: 2;
  quiet: boolean;
  headline: string;
  findings: PoShadowFinding[];
  purposeConflict: string | null;
  factSummary: string[];
  droppedFindingCount: number;
  // 이번 회차에 조회하지 못한 소스. 카드에 그대로 노출한다 — "이상 없음" 이 실은
  // "못 봤음" 이었던 회차를 사용자가 구분할 수 있어야 한다.
  degradedSources: string[];
}
