// 사실 기반 답변의 숫자 검사 — 모델이 지어낸 숫자를 막는다.
//
// 답에 나온 수치가 facts 값·질문 원문의 숫자·그 둘의 합이나 차 중 하나인지 본다. 날짜는 먼저 떼어 내
// 날짜끼리만 대조한다("10월 20일" 의 20 을 수치로 세면 엉뚱한 값이 우연히 통과하거나 걸린다).
//
// 이 검사는 계산이 맞다는 보증이 아니다. 원문 숫자를 그대로 되풀이한 틀린 답도 통과한다 — 정답 여부는
// 질문 eval(scripts/nl-answer-eval.ts)이 잰다. 곱셈·나눗셈 결과는 허용하지 않는 보수적 검사라,
// 그런 답은 결정론 요약으로 폴백된다.

export interface NumberCheck {
  ok: boolean;
  // 허용 집합에 없는 수치·날짜 토큰.
  unexpected: string[];
}

const ISO_DATE = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
const KOREAN_DATE = /(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/g;
const NUMBER = /\d+(?:\.\d+)?/g;

interface ExtractedDates {
  // "M-D" 키. 연도는 답에서 자주 생략돼 월·일로만 대조한다.
  monthDays: string[];
  rest: string;
}

const monthDayKey = (month: string, day: string): string =>
  `${Number(month)}-${Number(day)}`;

const extractDates = (text: string): ExtractedDates => {
  const monthDays: string[] = [];
  const rest = text
    .replace(ISO_DATE, (_match, _year: string, month: string, day: string) => {
      monthDays.push(monthDayKey(month, day));
      return ' ';
    })
    .replace(
      KOREAN_DATE,
      (_match, _year: string | undefined, month: string, day: string) => {
        monthDays.push(monthDayKey(month, day));
        return ' ';
      },
    );
  return { monthDays, rest };
};

const numbersIn = (text: string): number[] =>
  (text.match(NUMBER) ?? []).map(Number);

// facts 의 모든 수치(숫자 값, 문자열 안의 숫자, 배열 길이)와 날짜를 모은다.
const collectFacts = (
  value: unknown,
  numbers: number[],
  monthDays: Set<string>,
): void => {
  if (typeof value === 'number') {
    numbers.push(value);
    return;
  }
  if (typeof value === 'string') {
    const { monthDays: found, rest } = extractDates(value);
    found.forEach((key) => monthDays.add(key));
    numbers.push(...numbersIn(rest));
    return;
  }
  if (Array.isArray(value)) {
    numbers.push(value.length);
    value.forEach((item) => collectFacts(item, numbers, monthDays));
    return;
  }
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((item) =>
      collectFacts(item, numbers, monthDays),
    );
  }
};

const round = (value: number): number => Math.round(value * 100) / 100;

export const checkAnswerNumbers = ({
  reply,
  facts,
  question,
}: {
  reply: string;
  facts: unknown;
  question: string;
}): NumberCheck => {
  const factNumbers: number[] = [];
  const allowedMonthDays = new Set<string>();
  collectFacts(facts, factNumbers, allowedMonthDays);
  const questionParts = extractDates(question);
  questionParts.monthDays.forEach((key) => allowedMonthDays.add(key));

  const bases = [
    ...new Set([...factNumbers, ...numbersIn(questionParts.rest)]),
  ];
  const allowed = new Set<number>(bases.map(round));
  for (const left of bases) {
    for (const right of bases) {
      allowed.add(round(left + right));
      allowed.add(round(Math.abs(left - right)));
    }
  }

  const replyParts = extractDates(reply);
  const unexpected = [
    ...replyParts.monthDays
      .filter((key) => !allowedMonthDays.has(key))
      .map((key) => `날짜 ${key}`),
    ...numbersIn(replyParts.rest)
      .filter((value) => !allowed.has(round(value)))
      .map(String),
  ];
  return { ok: unexpected.length === 0, unexpected };
};
