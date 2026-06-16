export const RESUME_CALIBRATION_CRON_QUEUE = 'resume-calibration-cron';

export interface ResumeCalibrationCronJobData {
  ownerSlackUserId: string;
  target: string;
}

// 주 1회 — 월요일 10:00 KST 기본. 한 주 시작에 이력서 현재 기준 점검.
export const DEFAULT_RESUME_CALIBRATION_CRON = '0 10 * * 1';
export const DEFAULT_RESUME_CALIBRATION_TIMEZONE = 'Asia/Seoul';

// Hermes 웹리서치 프롬프트 — 현재 2026 이력서/채용 트렌드 조사 요약.
export const RESUME_TREND_RESEARCH_PROMPT =
  '웹검색으로 2026년 현재 개발자 이력서 작성 best practice 와 채용 트렌드를 조사해 핵심만 8줄 이내로 요약해줘. ' +
  'ATS, 정량화, AI 시대 이력서 주의점(generic AI 표현 회피), 최근 강조되는 역량 키워드 중심. 블로그 작성하지 말고 요약 텍스트만.';
