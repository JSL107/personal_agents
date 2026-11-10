import {
  addDaysTo,
  mondayOf,
  nextMonthStartOf,
} from '../../common/util/kst-date.util';

// 하루 기록을 조회할 기간. 저장소는 이 기간만 받아 조회하고, 기간을 정하는 규칙은 여기에 둔다.
// 'YYYY-MM-DD'(KST), from 포함·until 제외.
export interface DatePeriod {
  from: string;
  until: string;
}

// 같은 미션을 다시 고르지 않으려고 돌아보는 날 수.
export const MISSION_LOOKBACK_DAYS = 14;
const DAYS_PER_WEEK = 7;

// 오늘은 뺀다 — 같은 날 재시도가 자기 기록을 보고 다른 미션을 고르지 않게.
export const recentMissionPeriodOf = ({
  today,
}: {
  today: string;
}): DatePeriod => {
  const period: DatePeriod = {
    from: addDaysTo(today, -MISSION_LOOKBACK_DAYS),
    until: today,
  };
  return period;
};

// 그 날짜가 속한 월~일.
export const weekPeriodOf = ({ date }: { date: string }): DatePeriod => {
  const monday = mondayOf(date);
  const period: DatePeriod = {
    from: monday,
    until: addDaysTo(monday, DAYS_PER_WEEK),
  };
  return period;
};

// 그 날짜가 속한 달의 1일부터 다음 달 1일 전까지.
export const monthPeriodOf = ({ date }: { date: string }): DatePeriod => {
  const period: DatePeriod = {
    from: `${date.slice(0, 7)}-01`,
    until: nextMonthStartOf(date),
  };
  return period;
};
