import { calculateStreak, CardDayOutcome } from './streak';

const card = (
  openedDate: string,
  closedDate: string | null = openedDate,
): CardDayOutcome => ({ openedDate, closedDate });

describe('calculateStreak', () => {
  it('그날 뜬 카드를 그날 다 처리한 날만 연속으로 센다', () => {
    const result = calculateStreak(
      [card('2026-08-18'), card('2026-08-18'), card('2026-08-19')],
      '2026-08-20',
    );

    expect(result.current).toBe(2);
  });

  it('한 장이라도 다음날로 넘기면 그날은 실패다', () => {
    const result = calculateStreak(
      [
        card('2026-08-18'),
        card('2026-08-18'),
        card('2026-08-19'),
        // 같은 날 뜬 둘 중 하나만 그날 처리 — 나머지는 다음날 아침.
        card('2026-08-19', '2026-08-20'),
      ],
      '2026-08-21',
    );

    expect(result.current).toBe(0);
  });

  it('만료된 카드(결말 없음)도 실패로 센다', () => {
    const result = calculateStreak(
      [card('2026-08-18'), card('2026-08-19', null)],
      '2026-08-20',
    );

    expect(result.current).toBe(0);
  });

  it('카드가 0건인 날은 연속을 끊지도 늘리지도 않는다', () => {
    // 08-15 는 카드가 없다. 08-14 와 08-16 이 이어져야 한다.
    const result = calculateStreak(
      [card('2026-08-14'), card('2026-08-16'), card('2026-08-17')],
      '2026-08-18',
    );

    expect(result.current).toBe(3);
  });

  it('오늘은 판정하지 않고 남은 몫만 알려준다', () => {
    const result = calculateStreak(
      [
        card('2026-08-19'),
        // 오늘 뜬 두 장 중 한 장만 처리했다. 아직 자정이 오지 않았으므로 실패가 아니다.
        card('2026-08-20'),
        card('2026-08-20', null),
      ],
      '2026-08-20',
    );

    expect(result.current).toBe(1);
    expect(result.todayOpened).toBe(2);
    expect(result.todayRemaining).toBe(1);
  });

  it('최고 기록은 현재 연속이 끊긴 뒤에도 남는다', () => {
    const result = calculateStreak(
      [
        card('2026-08-10'),
        card('2026-08-11'),
        card('2026-08-12'),
        card('2026-08-13', null),
      ],
      '2026-08-14',
    );

    expect(result.current).toBe(0);
    expect(result.best).toBe(3);
  });

  it('이력이 없으면 0으로 시작한다', () => {
    const result = calculateStreak([], '2026-08-20');

    expect(result).toEqual({
      current: 0,
      best: 0,
      todayOpened: 0,
      todayRemaining: 0,
    });
  });

  // 로컬 원장(2026-08-20 기준) 실측을 그대로 재현한다. 유닛만 초록이고 실데이터와 어긋나는
  // 것을 막기 위한 대조군이라, 값이 바뀌면 계산 규칙이 바뀐 것인지 원장이 바뀐 것인지
  // 반드시 확인해야 한다.
  it('원장 실측을 재현한다 — 현재 0일, 최고 3일', () => {
    const outcomes: CardDayOutcome[] = [
      card('2026-08-09'),
      card('2026-08-10'),
      card('2026-08-10'),
      card('2026-08-11'),
      card('2026-08-11'),
      // 08-12: 두 장 모두 자정을 넘겨 08-13 새벽에 처리됐다.
      card('2026-08-12', '2026-08-13'),
      card('2026-08-12', '2026-08-13'),
      card('2026-08-13'),
      card('2026-08-13'),
      card('2026-08-14'),
      card('2026-08-14'),
      // 08-16: 두 장 중 한 장만 그날 처리.
      card('2026-08-16'),
      card('2026-08-16', '2026-08-17'),
      card('2026-08-17', '2026-08-18'),
      card('2026-08-17', '2026-08-18'),
      card('2026-08-18'),
      card('2026-08-18'),
      card('2026-08-19', '2026-08-20'),
      card('2026-08-19', '2026-08-20'),
      card('2026-08-19', '2026-08-20'),
    ];

    const result = calculateStreak(outcomes, '2026-08-20');

    expect(result.current).toBe(0);
    expect(result.best).toBe(3);
  });
});
