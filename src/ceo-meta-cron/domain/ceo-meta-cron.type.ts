import { AgentRunRange } from '../../common/domain/agent-run-range.type';

export const CEO_META_CRON_QUEUE = 'ceo-meta-cron';

export interface CeoMetaCronJobData {
  ownerSlackUserId: string;
  target: string;
  range: AgentRunRange;
}

// 주 1회 자동 /ceo-review — Daily Eval (`0 19 * * *`) 의 누적 PO_EVAL run 들을 메타 회고.
// 기본 일요일 18:00 KST — Weekly Summary (`0 17 * * 5` 금 17:00) 와 분리해 한 주 마감 시점.
export const DEFAULT_CEO_META_CRON = '0 18 * * 0';
export const DEFAULT_CEO_META_CRON_TIMEZONE = 'Asia/Seoul';
export const DEFAULT_CEO_META_CRON_RANGE: AgentRunRange = 'WEEK';
