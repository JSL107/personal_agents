import { calculateFourPillars } from 'manseryeok';

import { pillarFromHangul } from '../domain/day-pillar';
import { YearMonthPillars } from '../domain/saju-analysis';

// 년주는 입춘, 월주는 절입 "시각" 에 바뀌어 일진처럼 날짜 차이만으로는 안 나온다 — 절기표를 가진 만세력에 맡긴다.
// manseryeok 은 한국 시각(KST) 기준으로 절입을 비교한다. 1900~2100 년 일주·년주·월주를 lunar-javascript 와
// 레포의 dayPillarOf 로 교차 대조해 불일치 0 을 확인했다(2026-11-09).
// domain 은 외부 라이브러리에 의존하지 않으므로(AGENTS.md §2) 여기서 계산해 프롬프트 빌더에 값으로 넘긴다.
// 정오로 고정하는 이유: 아침 운세와 그날 스레드 답이 같은 값을 써야 한다. 절입일엔 발송 시각에 따라 갈릴 수 있다.
const REPRESENTATIVE_HOUR = 12;

const PLAIN_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// plainDate: KST 기준 'YYYY-MM-DD'. 달력에 없는 날은 manseryeok 이 RangeError 로 끊는다.
export const yearMonthPillarsOf = (plainDate: string): YearMonthPillars => {
  const matched = PLAIN_DATE_PATTERN.exec(plainDate);
  if (!matched) {
    throw new Error(`년주·월주 계산 날짜 형식 오류: ${plainDate}`);
  }
  const [, year, month, day] = matched;
  const pillars = calculateFourPillars({
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: REPRESENTATIVE_HOUR,
    minute: 0,
  });
  return {
    yearPillar: pillarFromHangul({
      stem: pillars.year.heavenlyStem,
      branch: pillars.year.earthlyBranch,
    }),
    monthPillar: pillarFromHangul({
      stem: pillars.month.heavenlyStem,
      branch: pillars.month.earthlyBranch,
    }),
  };
};
