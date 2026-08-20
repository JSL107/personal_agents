import { ConsoleStreak } from './briefing.type';

/**
 * 연속 기록 계산의 입력 한 건. 승인 카드 하나의 생애를 KST 캘린더 날짜로 압축한 것.
 *
 * 시각이 아니라 **날짜 문자열**을 받는 이유는 이 함수를 timezone 에서 떼어 내기 위해서다.
 * KST 변환은 호출자가 `formatKstDate` 로 한 번에 끝내고, 여기서는 문자열 비교만 한다.
 */
export interface CardDayOutcome {
  /** 카드가 뜬 KST 날짜(YYYY-MM-DD). */
  readonly openedDate: string;
  /** 승인·거절로 결말이 난 KST 날짜. 아직 열려 있거나 만료됐으면 null. */
  readonly closedDate: string | null;
}

/** 하루 판정. 카드가 0건인 날은 아예 집계에 나타나지 않으므로 중립을 값으로 두지 않는다. */
type DayVerdict = 'KEPT' | 'BROKEN';

interface DayTally {
  opened: number;
  closedSameDay: number;
}

/**
 * 승인 카드 이력에서 연속 기록을 센다(순수).
 *
 * **판정**: 그날 뜬 카드가 **전부** 그날 안에 결말이 났으면 성공이다. 한 장이라도 다음날로
 * 넘어가거나 만료되면 실패다. 카드가 0건인 날은 중립이라 연속을 끊지도 늘리지도 않는다 —
 * 도장을 찍을 일이 없던 날을 실패로 치면 조용한 날에 기록이 끊기고, 성공으로 치면 아무 일도
 * 하지 않고 숫자가 오른다.
 *
 * **오늘은 세지 않는다.** 아직 자정이 오지 않아 판정이 확정되지 않았다. 대신 오늘 몫이 얼마나
 * 남았는지를 따로 실어 화면이 "오늘 몫 2건 남음" 을 보여줄 수 있게 한다.
 */
export const calculateStreak = (
  outcomes: readonly CardDayOutcome[],
  todayDate: string,
): ConsoleStreak => {
  const tallyByDate = new Map<string, DayTally>();
  for (const outcome of outcomes) {
    const tally = tallyByDate.get(outcome.openedDate) ?? {
      opened: 0,
      closedSameDay: 0,
    };
    tally.opened += 1;
    if (outcome.closedDate === outcome.openedDate) {
      tally.closedSameDay += 1;
    }
    tallyByDate.set(outcome.openedDate, tally);
  }

  const todayTally = tallyByDate.get(todayDate) ?? {
    opened: 0,
    closedSameDay: 0,
  };
  // 오늘은 판정 대상이 아니므로 연속 계산에서 빼고, 남은 몫만 화면에 넘긴다.
  tallyByDate.delete(todayDate);

  const verdictByDate = new Map<string, DayVerdict>();
  for (const [date, tally] of tallyByDate) {
    verdictByDate.set(
      date,
      tally.closedSameDay === tally.opened ? 'KEPT' : 'BROKEN',
    );
  }

  // 과거 → 현재 순. 중립인 날은 애초에 목록에 없으므로 자연히 건너뛰어진다.
  const datesAscending = [...verdictByDate.keys()].sort((left, right) =>
    left.localeCompare(right),
  );

  return {
    current: countCurrentStreak(datesAscending, verdictByDate),
    best: countBestStreak(datesAscending, verdictByDate),
    todayOpened: todayTally.opened,
    todayRemaining: todayTally.opened - todayTally.closedSameDay,
  };
};

// 가장 최근 판정일부터 거꾸로 세다가 실패를 만나면 멈춘다.
const countCurrentStreak = (
  datesAscending: readonly string[],
  verdictByDate: ReadonlyMap<string, DayVerdict>,
): number => {
  let streak = 0;
  for (let index = datesAscending.length - 1; index >= 0; index -= 1) {
    if (verdictByDate.get(datesAscending[index]) !== 'KEPT') {
      return streak;
    }
    streak += 1;
  }
  return streak;
};

const countBestStreak = (
  datesAscending: readonly string[],
  verdictByDate: ReadonlyMap<string, DayVerdict>,
): number => {
  let best = 0;
  let running = 0;
  for (const date of datesAscending) {
    if (verdictByDate.get(date) === 'KEPT') {
      running += 1;
      best = Math.max(best, running);
      continue;
    }
    running = 0;
  }
  return best;
};
