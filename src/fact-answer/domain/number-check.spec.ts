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
});
