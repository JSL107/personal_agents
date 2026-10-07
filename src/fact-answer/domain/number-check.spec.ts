import { checkAnswerNumbers } from './number-check';

const vacationFacts = {
  current: {
    periodStart: '2026-04-06',
    periodEnd: '2027-04-05',
    granted: 8,
    used: 4,
    remaining: 4,
  },
  usages: [
    { id: 5, start: '2026-09-21', end: '2026-09-21', days: 1 },
    { id: 4, start: '2026-07-24', end: '2026-07-24', days: 0.5 },
  ],
};

describe('checkAnswerNumbers', () => {
  it('facts·질문의 숫자와 그 합·차만 쓴 답은 통과한다', () => {
    expect(
      checkAnswerNumbers({
        reply: '네, 맞아요. 부여 8일 − 사용 4일 = 잔여 4일이에요.',
        facts: vacationFacts,
        question: '8일 기준이라면 4일이 남은게 맞아?',
      }),
    ).toEqual({ ok: true, unexpected: [] });
  });

  it('가정한 사용량을 뺀 값(차)도 통과한다', () => {
    expect(
      checkAnswerNumbers({
        reply: '3일을 쓰면 잔여 4일에서 1일이 남아요.',
        facts: vacationFacts,
        question: '다음주 3일 쓰면 며칠 남아?',
      }).ok,
    ).toBe(true);
  });

  it('반차 0.5 와 여러 건 합계(1 + 0.5 = 1.5)를 통과시킨다', () => {
    expect(
      checkAnswerNumbers({
        reply: '최근 두 번 합쳐 1.5일 썼어요(1일, 0.5일).',
        facts: vacationFacts,
        question: '최근에 며칠 썼어?',
      }).ok,
    ).toBe(true);
  });

  it('근거 없는 숫자를 잡는다', () => {
    expect(
      checkAnswerNumbers({
        reply: '잔여는 11일이에요.',
        facts: vacationFacts,
        question: '휴가 몇 개 남았어?',
      }),
    ).toEqual({ ok: false, unexpected: ['11'] });
  });

  it('날짜는 날짜끼리만 대조한다 — 기록에 있는 날짜는 통과, 없는 날짜는 잡는다', () => {
    expect(
      checkAnswerNumbers({
        reply: '9월 21일에 하루, 7월 24일에 반차를 썼어요.',
        facts: vacationFacts,
        question: '휴가 언제 썼지?',
      }).ok,
    ).toBe(true);
    expect(
      checkAnswerNumbers({
        reply: '8월 15일에 하루 썼어요.',
        facts: vacationFacts,
        question: '휴가 언제 썼지?',
      }).unexpected,
    ).toEqual(['날짜 8-15']);
  });

  it('질문에 나온 날짜는 답에 써도 된다', () => {
    expect(
      checkAnswerNumbers({
        reply: '10월 20일에 반차를 쓰면 잔여 3.5일이에요.',
        facts: vacationFacts,
        question: '10월 20일 반차 쓰면 며칠 남아?',
      }).ok,
    ).toBe(true);
  });

  it('기록 번호(id)는 수량 근거가 아니다 — id 로만 나오는 값을 수량으로 쓰면 잡는다', () => {
    // 13 은 기록 번호로만 있다. 수량(잔여 4·사용 1)과 그 합·차로는 나오지 않는다.
    expect(
      checkAnswerNumbers({
        reply: '잔여는 13일이에요.',
        facts: { remaining: 4, usages: [{ id: 13, days: 1 }] },
        question: '휴가 몇 개 남았어?',
      }).unexpected,
    ).toEqual(['13']);
  });

  it('번호로 쓴 값("5번", "#4")은 기록 번호와 대조해 통과시킨다', () => {
    expect(
      checkAnswerNumbers({
        reply: '5번 기록(9월 21일)과 #4 기록이 있어요.',
        facts: vacationFacts,
        question: '휴가 내역 알려줘',
      }).ok,
    ).toBe(true);
    expect(
      checkAnswerNumbers({
        reply: '9번 기록을 취소하면 돼요.',
        facts: vacationFacts,
        question: '어떤 걸 취소해야 해?',
      }).unexpected,
    ).toEqual(['번호 9']);
  });

  it('"3번째" 는 번호가 아니라 수량으로 본다 — 기록 번호가 아니라 수치와 대조한다', () => {
    expect(
      checkAnswerNumbers({
        reply: '지금까지 3번째 지원이에요.',
        facts: { total: 3, applications: [{ id: 7 }] },
        question: '토스가 몇 번째 지원이야?',
      }).ok,
    ).toBe(true);
  });

  it('연도까지 적은 날짜는 연도까지 대조한다 — 다른 해의 같은 날짜는 잡는다', () => {
    expect(
      checkAnswerNumbers({
        reply: '2026-09-21 에 하루 썼어요.',
        facts: vacationFacts,
        question: '언제 썼지?',
      }).ok,
    ).toBe(true);
    expect(
      checkAnswerNumbers({
        reply: '2025년 9월 21일에 하루 썼어요.',
        facts: vacationFacts,
        question: '언제 썼지?',
      }).unexpected,
    ).toEqual(['날짜 2025-9-21']);
  });

  it('facts 에 코드가 계산해 넣은 값(지금 지원하면 몇 번째)은 그대로 통과한다', () => {
    expect(
      checkAnswerNumbers({
        reply: '지금 지원하면 3번째 지원이고, 이번 달로는 2번째예요.',
        facts: {
          total: 2,
          appliedThisMonth: 1,
          ifAppliedNow: { ordinal: 3, ordinalThisMonth: 2 },
        },
        question: '토스 백엔드 지원하면 몇 번째 지원이야?',
      }).ok,
    ).toBe(true);
  });
});
