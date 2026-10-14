import { addDays } from '../../agent/vacation/domain/plain-date';

// 게임잡 마감 표기는 '채용시'·'상시'·'~10/31'·'~10/31(금)'·'오늘마감'·'D-3' 이 섞여 온다(2026-10-13 실측).
// 읽는 사람이 급한 공고를 바로 알아보게 남은 일수로 맞추고, 임박한 것만 표시한다.
const URGENT_WITHIN_DAYS = 3;
const ROLLING_WORDS = ['채용시', '상시', '수시'];
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PlainMonthDay {
  year: number;
  month: number;
  day: number;
}

export interface NormalizedDeadline {
  label: string;
  urgent: boolean;
}

const withDaysLeft = (prefix: string, daysLeft: number): NormalizedDeadline => {
  if (daysLeft <= 0) {
    return { label: '오늘 마감', urgent: true };
  }
  return {
    label: `${prefix}D-${daysLeft}`,
    urgent: daysLeft <= URGENT_WITHIN_DAYS,
  };
};

// 마감 월/일만 오므로 연도를 추정한다. 오늘보다 반년 넘게 앞선 날짜는 내년으로 본다(12월에 본 1월 마감).
const daysUntil = (
  today: PlainMonthDay,
  month: number,
  day: number,
): number => {
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
  let target = Date.UTC(today.year, month - 1, day);
  if (target < todayUtc - (DAY_MS * 365) / 2) {
    target = Date.UTC(today.year + 1, month - 1, day);
  }
  return Math.round((target - todayUtc) / DAY_MS);
};

// 라벨과 날짜를 한 규칙으로 낸다 — 게시 라벨과 장부의 마감일(전날 알림 기준)이 갈리지 않게.
interface ResolvedDeadline extends NormalizedDeadline {
  // 상시·채용시·해석 못 한 표기는 null.
  date: PlainMonthDay | null;
}

const resolveDeadline = (
  raw: string | null,
  today: PlainMonthDay,
): ResolvedDeadline | null => {
  if (!raw) {
    return null;
  }
  const text = raw.replace(/\s+/g, '');
  if (ROLLING_WORDS.some((word) => text.includes(word))) {
    return { label: '상시', urgent: false, date: null };
  }
  if (text.includes('오늘')) {
    return { label: '오늘 마감', urgent: true, date: today };
  }
  if (text.includes('내일')) {
    return { label: '내일 마감', urgent: true, date: addDays(today, 1) };
  }
  const dDay = /D-(\d+)/i.exec(text);
  if (dDay) {
    const daysLeft = Number(dDay[1]);
    return { ...withDaysLeft('', daysLeft), date: addDays(today, daysLeft) };
  }
  const monthDay = /(\d{1,2})\/(\d{1,2})/.exec(text);
  if (monthDay) {
    const month = Number(monthDay[1]);
    const day = Number(monthDay[2]);
    const daysLeft = daysUntil(today, month, day);
    return {
      ...withDaysLeft(`~${month}/${day} `, daysLeft),
      date: addDays(today, daysLeft),
    };
  }
  return { label: raw.trim(), urgent: false, date: null };
};

export const normalizeDeadline = (
  raw: string | null,
  today: PlainMonthDay,
): NormalizedDeadline | null => {
  const resolved = resolveDeadline(raw, today);
  return resolved ? { label: resolved.label, urgent: resolved.urgent } : null;
};

// 마감 날짜(KST). 날짜를 정할 수 없는 표기(상시·채용시 등)는 null — 「관심 있음」 버튼을 달지 않는다.
export const deadlineDateOf = (
  raw: string | null,
  today: PlainMonthDay,
): PlainMonthDay | null => {
  return resolveDeadline(raw, today)?.date ?? null;
};
