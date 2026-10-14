import { ART_JOB_REMINDER_HOURS_KST } from '../../art-job-feed/domain/art-job-interest';

export const ART_JOB_DEADLINE_CRON_QUEUE = 'art-job-deadline-cron';

export interface ArtJobDeadlineCronJobData {
  // 알림을 받을 사람 — 원화 공고 버튼을 누를 수 있는 사람(ART_JOB_FEED_MENTION_USER_ID)과 같다.
  recipient: string;
  // 실패 알림을 받을 사람. 없으면 로그만 남긴다.
  ownerSlackUserId: string | null;
}

// 마감 전날 09:00·13:00 KST. 시각은 「관심 있음」 안내(hasReminderLeft)와 같은 상수에서 만든다.
// 타임존은 고정한다 — 바꾸면 그 안내가 실제 발송 시각과 어긋난다.
export const ART_JOB_DEADLINE_CRON = `0 ${ART_JOB_REMINDER_HOURS_KST.join(',')} * * *`;
export const ART_JOB_DEADLINE_TIMEZONE = 'Asia/Seoul';

// 이 시간 안에 이미 보낸 공고는 건너뛴다 — 같은 회차의 재시도는 막고, 4시간 뒤 다음 회차는 보낸다.
export const REMIND_GAP_HOURS = 3;
