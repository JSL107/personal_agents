export const ART_JOB_FEED_CRON_QUEUE = 'art-job-feed-cron';

export interface ArtJobFeedCronJobData {
  target: string;
  mentionUserId: string | null;
  // 실패 알림을 받을 사람. 없으면 로그만 남긴다.
  ownerSlackUserId: string | null;
  trigger?: 'CRON' | 'MANUAL';
}

export type ArtJobFeedRunResult =
  | { kind: 'POSTED'; count: number }
  | { kind: 'NO_NEW' }
  | { kind: 'SLOT_TAKEN' };

// 하루 2회(09:00·18:00 KST). cron 하나로 두 시각을 표현한다.
export const DEFAULT_ART_JOB_FEED_CRON = '0 9,18 * * *';
export const DEFAULT_ART_JOB_FEED_TIMEZONE = 'Asia/Seoul';

// 실행당 게시 상한. 넘친 공고는 장부에 안 남기고 다음 회차로 넘긴다(첫 실행은 예외 — SEED).
export const MAX_POSTINGS_PER_RUN = 10;
// 등록일순 40건 × 2쪽. 하루 2회 실행에 신규 원화 공고가 80건을 넘을 일은 실측상 없다.
export const LIST_PAGES_PER_RUN = 2;
