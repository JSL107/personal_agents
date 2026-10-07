// 사실 기반 답변의 숫자 검사 — 모델이 지어낸 숫자를 막는다.
//
// 답에 나온 수치가 facts 값·질문 원문의 숫자·그 둘의 합이나 차 중 하나인지 본다. 날짜와 식별자는 수치와
// 따로 대조한다 — 섞어 두면 "10월 20일" 의 20 이나 기록 번호 5 가 우연히 같은 잔여·집계값을 통과시킨다.
//
// 이 검사는 계산이 맞다는 보증이 아니다. 원문 숫자를 그대로 되풀이한 틀린 답도 통과한다 — 정답 여부는
// 질문 eval(scripts/nl-answer-eval.ts)이 잰다. 곱셈·나눗셈 결과는 허용하지 않는 보수적 검사라,
// 그런 답은 결정론 요약으로 폴백된다.

export interface NumberCheck {
  ok: boolean;
  // 허용 집합에 없는 수치·날짜·번호 토큰.
  unexpected: string[];
}

const ISO_DATE = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
const KOREAN_DATE = /(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/g;
// "5번", "#5" 처럼 번호로 쓴 값. "3번째" 는 순서(수량)라 번호가 아니다.
const ID_TOKEN = /#(\d+)|(\d+)\s*번(?!째)/g;
const NUMBER = /\d+(?:\.\d+)?/g;
// facts 에서 식별자로 보는 키. 수량 근거로 쓰지 않는다.
const ID_KEY = /^(?:id|.+Id)$/;

interface ExtractedDates {
  // 연도까지 적힌 날짜("2026-9-21")와 월·일만 적힌 날짜("9-21").
  fullDates: string[];
  monthDays: string[];
  rest: string;
}

const dayKey = (month: string, day: string): string =>
  `${Number(month)}-${Number(day)}`;

const extractDates = (text: string): ExtractedDates => {
  const fullDates: string[] = [];
  const monthDays: string[] = [];
  const push = (
    year: string | undefined,
    month: string,
    day: string,
  ): string => {
    if (year === undefined) {
      monthDays.push(dayKey(month, day));
    } else {
      fullDates.push(`${Number(year)}-${dayKey(month, day)}`);
    }
    return ' ';
  };
  const rest = text
    .replace(ISO_DATE, (_match, year: string, month: string, day: string) =>
      push(year, month, day),
    )
    .replace(
      KOREAN_DATE,
      (_match, year: string | undefined, month: string, day: string) =>
        push(year, month, day),
    );
  return { fullDates, monthDays, rest };
};

const numbersIn = (text: string): number[] =>
  (text.match(NUMBER) ?? []).map(Number);

interface FactSets {
  numbers: number[];
  ids: Set<number>;
  fullDates: Set<string>;
  monthDays: Set<string>;
}

const addDates = (sets: FactSets, extracted: ExtractedDates): void => {
  extracted.fullDates.forEach((key) => {
    sets.fullDates.add(key);
    // 연도를 생략한 답("9월 21일")도 그 날짜로 인정한다.
    sets.monthDays.add(key.split('-').slice(1).join('-'));
  });
  extracted.monthDays.forEach((key) => sets.monthDays.add(key));
};

// facts 의 수치(숫자 값, 문자열 안의 숫자, 배열 길이)·식별자·날짜를 모은다.
const collectFacts = (value: unknown, sets: FactSets, key?: string): void => {
  if (typeof value === 'number') {
    if (key !== undefined && ID_KEY.test(key)) {
      sets.ids.add(value);
    } else {
      sets.numbers.push(value);
    }
    return;
  }
  if (typeof value === 'string') {
    const extracted = extractDates(value);
    addDates(sets, extracted);
    sets.numbers.push(...numbersIn(extracted.rest));
    return;
  }
  if (Array.isArray(value)) {
    sets.numbers.push(value.length);
    value.forEach((item) => collectFacts(item, sets));
    return;
  }
  if (value !== null && typeof value === 'object') {
    Object.entries(value).forEach(([childKey, item]) =>
      collectFacts(item, sets, childKey),
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
  const sets: FactSets = {
    numbers: [],
    ids: new Set<number>(),
    fullDates: new Set<string>(),
    monthDays: new Set<string>(),
  };
  collectFacts(facts, sets);
  const questionDates = extractDates(question);
  addDates(sets, questionDates);
  // 질문에 나온 번호("12번 취소하면")는 답에서 번호로 다시 써도 된다.
  for (const match of questionDates.rest.matchAll(ID_TOKEN)) {
    sets.ids.add(Number(match[1] ?? match[2]));
  }
  const questionNumbers = numbersIn(questionDates.rest.replace(ID_TOKEN, ' '));

  const bases = [...new Set([...sets.numbers, ...questionNumbers])];
  const allowed = new Set<number>(bases.map(round));
  for (const left of bases) {
    for (const right of bases) {
      allowed.add(round(left + right));
      allowed.add(round(Math.abs(left - right)));
    }
  }

  const replyDates = extractDates(reply);
  const unexpected: string[] = [
    ...replyDates.fullDates
      .filter((key) => !sets.fullDates.has(key))
      .map((key) => `날짜 ${key}`),
    ...replyDates.monthDays
      .filter((key) => !sets.monthDays.has(key))
      .map((key) => `날짜 ${key}`),
  ];
  for (const match of replyDates.rest.matchAll(ID_TOKEN)) {
    const id = Number(match[1] ?? match[2]);
    if (!sets.ids.has(id)) {
      unexpected.push(`번호 ${id}`);
    }
  }
  unexpected.push(
    ...numbersIn(replyDates.rest.replace(ID_TOKEN, ' '))
      .filter((value) => !allowed.has(round(value)))
      .map(String),
  );
  return { ok: unexpected.length === 0, unexpected };
};
