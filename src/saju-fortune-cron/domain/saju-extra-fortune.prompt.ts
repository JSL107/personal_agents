import { match } from 'ts-pattern';

import { pillarToHangul } from './day-pillar';
import { analyzeSajuDay, formatSajuFacts } from './saju-analysis';
import { SajuFortuneRecipient } from './saju-fortune-cron.type';
import { EXTRA_SECTION_SEPARATOR } from './saju-fortune-render';
import {
  changesFlow,
  SOLAR_TERM_MEANINGS,
  SolarTermToday,
  SpecialDay,
  SpecialDayContext,
  SpecialDayKind,
  SpecialSolarTerm,
} from './special-day';
import { DailyScores, formatWeeklyFacts } from './weekly-fortune';

// 추가 메시지(특별한 날 특집·월요일 주간 운세) 프롬프트. 일일 운세와 같은 원칙 — 날짜·시각·흐름·요일은
// 코드가 확정해 사실로 주고, AI 는 글만 쓴다. 특집 줄·주간 별점 줄은 코드가 붙이므로 AI 는 쓰지 않는다.
export interface ExtraFortunePromptInput {
  recipient: SajuFortuneRecipient;
  todayKst: string;
  todayPillar: string;
  // 지금 KST 'HH:MM' — 절입 시각과 견줘 "오늘 ○시부터 바뀐다/바뀌었다" 를 고르게 한다.
  nowKst: string;
  specialDays: SpecialDay[];
  context: SpecialDayContext;
  // 월요일이면 7일 별점.
  week?: DailyScores[];
}

export const expectedSectionCount = ({
  specialDays,
  week,
}: {
  specialDays: SpecialDay[];
  week?: DailyScores[];
}): number => {
  const weekSectionCount = week ? 1 : 0;
  const count = specialDays.length + weekSectionCount;
  return count;
};

export const buildExtraFortunePrompt = ({
  recipient,
  todayKst,
  todayPillar,
  nowKst,
  specialDays,
  context,
  week,
}: ExtraFortunePromptInput): string => {
  const sectionCount = expectedSectionCount({ specialDays, week });
  // 흐름 사실(정오 대표값)은 싣지 않는다 — 1월 1일·입춘 전 설날엔 지난해 간지라서다. 흐름은 절 특집이 따로 준다.
  const todayFacts = formatSajuFacts(
    analyzeSajuDay({ natalPillars: recipient.natalPillars, todayPillar }),
  );
  const specialSections = specialDays.map((day, index) => [
    `구간 ${index + 1} — 특별한 날`,
    ...formatSpecialDayFacts({ days: [day], recipient, context }),
  ]);
  const sections = [...specialSections];
  if (week) {
    sections.push([
      `구간 ${sectionCount} — 이번 주 운세(월~일)`,
      '이번 주 항목별 좋은 날·조심할 날 (코드가 확정했다. 이것만 근거로 써라):',
      ...formatWeeklyFacts(week),
    ]);
  }

  const sectionRuleLine =
    sectionCount > 1
      ? `- 구간 ${sectionCount}개를 위 순서대로 쓰고, 구간 사이에는 "${EXTRA_SECTION_SEPARATOR}" 한 줄만 둔다.`
      : `- 구간 1개만 쓴다. "${EXTRA_SECTION_SEPARATOR}" 구분줄은 쓰지 않는다.`;

  const prompt = [
    '너는 사주를 전혀 모르는 친한 사람에게 일일 운세에 이어 한 통 더 보내 주는 역할이다.',
    '',
    `- 받는 사람: ${recipient.name}`,
    `- 오늘: ${todayKst}, 오늘 일진: ${pillarToHangul(todayPillar)}일 (확정값이다. 다시 계산하지 마라.)`,
    `- 지금 시각: ${spokenTime(nowKst)}`,
    '',
    '오늘의 계산된 사실 (코드가 확정한 값이다. 다시 계산하지 말고 이것만 근거로 써라):',
    ...todayFacts,
    '',
    ...sections.flatMap((section) => [...section, '']),
    '작성 형식:',
    sectionRuleLine,
    '- 구간 제목·특집 첫 줄(🎂 같은 줄)·요일별 별점 줄은 쓰지 않는다. 코드가 따로 붙인다.',
    '- 특별한 날 구간은 3~5줄: 축하나 그날의 의미 한 줄, 오늘 기운과 엮은 이야기, 그날에 어울리는 작은 행동 하나.',
    '- 이번 주 구간은 이번 주 흐름 2~3줄 뒤에 "총운:", "일·공부:", "사람 관계:", "돈:", "컨디션:" 으로 시작하는 줄을 하나씩 쓴다. 좋은 날·조심할 날이 사실에 있으면 그 요일 이름으로 쓰고, 없으면 요일을 쓰지 말고 "무난한 한 주" 처럼 쓴다. 조심할 날이 있는 항목에만 "그럴 땐 이렇게 해 봐" 식의 대처를 한 마디 붙인다.',
    '',
    '작성 규칙:',
    '- 한자를 한 글자도 쓰지 않는다. 간지·오행은 한글로만 쓴다.',
    '- 편재·식신·충·극·합 같은 명리 용어는 한 번도 쓰지 않는다. 쉬운 말로 쓴다.',
    '- 사실에 없는 관계·요일·날짜를 지어내지 않는다.',
    '- 별점·점수·행운 숫자는 쓰지 않는다(코드가 따로 붙인다). 🍀 이모지는 쓰지 않는다.',
    '- 재미로 보는 운세 말투(반말, 다정하게)로 쓴다. 사고·질병·금전 손실을 단정하거나 겁주는 말은 쓰지 않는다.',
    '- 평문으로 쓴다. 제목·표·코드블록은 쓰지 않고, 이모지는 줄 머리에 하나까지만 쓴다.',
  ];
  const joinedPrompt = prompt.join('\n');
  return joinedPrompt;
};

// 특별한 날 사실 — 추가 메시지 프롬프트와 스레드 답(answer-fortune-question)이 같은 문장을 쓴다.
export const formatSpecialDayFacts = ({
  days,
  recipient,
  context,
}: {
  days: SpecialDay[];
  recipient: SajuFortuneRecipient;
  context: SpecialDayContext;
}): string[] =>
  days.flatMap((day) => specialDayFacts({ day, recipient, context }));

// 특별한 날 종류가 늘면 .exhaustive() 가 빌드에서 잡는다(CODE_RULES §4).
const specialDayFacts = ({
  day,
  recipient,
  context,
}: {
  day: SpecialDay;
  recipient: SajuFortuneRecipient;
  context: SpecialDayContext;
}): string[] => {
  const ipchunFact = `- 사주의 새해는 입춘(${spokenDate(context.ipchun.date)})부터다. 오늘 사주의 해가 바뀐다고 쓰지 않는다.`;
  const facts = match(day)
    .with({ kind: SpecialDayKind.BIRTHDAY }, () => [
      `- 오늘은 ${recipient.name}의 생일이다. 진심으로 축하하고, 한 살 더 먹는 앞으로의 1년에 어울리는 작은 다짐 하나를 권한다("새해"라고 부르지 않는다 — 달력의 새해가 아니다).`,
    ])
    .with({ kind: SpecialDayKind.SEOLLAL }, () => [
      '- 오늘은 설날(음력 새해 첫날)이다. 결: 가족과 함께하는 쉼, 마음 편한 하루.',
      ipchunFact,
    ])
    .with({ kind: SpecialDayKind.NEW_YEAR }, () => [
      '- 오늘은 달력의 새해 첫날이다. 결: 달력의 새 출발, 한 해의 계획.',
      ipchunFact,
    ])
    .with({ kind: SpecialDayKind.SOLAR_TERM }, ({ solarTerm }) =>
      solarTermFacts({ solarTerm, context }),
    )
    .exhaustive();
  return facts;
};

const solarTermFacts = ({
  solarTerm: { name, timeKst },
  context,
}: {
  solarTerm: SolarTermToday;
  context: SpecialDayContext;
}): string[] => {
  const termTime = spokenTime(timeKst);
  const termFacts = [
    `- 오늘은 ${name}(${SOLAR_TERM_MEANINGS[name].meaning})이다. 절기가 드는 시각: ${termTime}.`,
  ];
  if (!changesFlow(name) || !context.termFlow) {
    return [
      ...termFacts,
      '- 이 절기는 올해·이번 달의 흐름을 바꾸지 않는다. 흐름이 바뀐다고 쓰지 않는다.',
    ];
  }
  const { yearPillar, monthPillar } = context.termFlow;
  const flowTone =
    name === SpecialSolarTerm.입춘
      ? '- 결: 사주의 새해 — 기운이 새로 바뀌는 날.'
      : '- 결: 계절이 바뀌며 이번 달의 기운도 바뀌는 날.';
  const flowFacts = [
    flowTone,
    `- ${termTime}부터 바뀌는 흐름: 올해 ${pillarToHangul(yearPillar)}년, 이번 달 ${pillarToHangul(monthPillar)}월.`,
    `- 지금 시각이 ${termTime}보다 이르면 "오늘 ${termTime}부터 바뀐다" 처럼 앞으로 올 일로, 지났으면 "오늘 ${termTime}부터 바뀌었다" 처럼 쓴다.`,
  ];
  return [...termFacts, ...flowFacts];
};

// 'HH:MM' → '7시 30분'
const spokenTime = (time: string): string => {
  const [hour, minute] = time.split(':').map(Number);
  const spoken = `${hour}시 ${minute}분`;
  return spoken;
};

// 'YYYY-MM-DD' → '2월 4일'
const spokenDate = (date: string): string => {
  const [, month, day] = date.split('-').map(Number);
  const spoken = `${month}월 ${day}일`;
  return spoken;
};
