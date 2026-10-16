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
// 원화 직종 목록을 끝까지 읽는 상한(40건 × 10쪽). 예전에는 앞 2쪽(80건)만 읽어, 기능을 켜기 전에 올라온
// 상시·채용시 공고 67건이 한 번도 안 나갔다(2026-10-16 실측: 원화 222건 중 제목 필터 통과 112건, 미발송 67건).
// 목록이 최신순이라 회차당 상한(MAX_POSTINGS_PER_RUN)을 새 공고가 먼저 채우고, 남는 자리에 밀린 공고가 들어간다.
export const MAX_LIST_PAGES_PER_RUN = 10;
