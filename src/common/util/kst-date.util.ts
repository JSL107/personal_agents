const KST_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// 서버 timezone (UTC 가능) 과 무관하게 KST 기준 YYYY-MM-DD 반환.
// en-CA 로케일은 ISO 8601 ("2026-05-29") 형식을 그대로 출력 — 별도 padding 없음.
// Daily Eval / Impact Report Cron 등 cron consumer 의 Slack 헤더 날짜 표기 공통 유틸.
export const getTodayKstDate = (): string =>
  KST_DATE_FORMATTER.format(new Date());

// ISO 8601 시각을 KST 캘린더 날짜로 변환한다. fallback 문구는 caller가 결정할 수 있도록
// 파싱할 수 없는 값에는 null을 반환한다.
export const formatKstDate = (
  isoDateTime: string | null | undefined,
): string | null => {
  // new Date(null)는 epoch가 되어 NaN 검사만으로는 결측 날짜를 막을 수 없다.
  if (!isoDateTime || isoDateTime.trim().length === 0) {
    return null;
  }
  const date = new Date(isoDateTime);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return KST_DATE_FORMATTER.format(date);
};

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// KST 기준 (오늘 - daysAgo) 일의 00:00 을 가리키는 UTC Date.
// 서버 timezone 과 무관하게 KST 캘린더일 필터 경계를 만든다.
export const getKstDayStartAsUtc = (daysAgo = 0): Date => {
  const kstNow = new Date(Date.now() + KST_OFFSET_MS);
  const kstMidnightAsUtcTs = Date.UTC(
    kstNow.getUTCFullYear(),
    kstNow.getUTCMonth(),
    kstNow.getUTCDate() - daysAgo,
  );
  return new Date(kstMidnightAsUtcTs - KST_OFFSET_MS);
};
