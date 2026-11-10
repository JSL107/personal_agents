import { utcMidnightOf } from '../../common/util/kst-date.util';
import { pillarToHangul } from './day-pillar';
import {
  analyzeSajuDay,
  formatSajuFacts,
  YearMonthPillars,
} from './saju-analysis';
import { CARD_SCENE_LABEL, CARD_TITLE_LABEL } from './saju-fortune-card';
import { SajuFortuneRecipient } from './saju-fortune-cron.type';

const PILLAR_LABELS = ['년주', '월주', '일주', '시주'];
// 날마다 돌아가는 비유 소재. 소재를 주지 않으면 모델이 매일 같은 자연 비유("단단한 쇠 기운",
// "흐르는 물")로 시작해 받는 사람에게 같은 글로 읽혔다. 같은 날짜는 항상 같은 소재라 재시도해도 안 바뀐다.
export const METAPHOR_THEMES = [
  '날씨와 하늘',
  '여행길',
  '요리와 부엌',
  '운동 경기',
  '음악과 노래',
  '정원 가꾸기',
  '바다와 항해',
  '책과 이야기',
  '시장과 가게',
  '산책길',
  '게임 한 판',
  '계절의 변화',
] as const;
const MILLISECONDS_PER_DAY = 86_400_000;

// todayKst: 'YYYY-MM-DD'. 날짜 형식은 dayPillarOf 가 먼저 검사한다.
export const metaphorThemeOf = (todayKst: string): string => {
  const days = Math.floor(
    utcMidnightOf(todayKst).getTime() / MILLISECONDS_PER_DAY,
  );
  // 날마다 한 칸씩 돌고, 소재 수만큼 지나면 처음으로 돌아온다.
  const themeIndex = days % METAPHOR_THEMES.length;
  return METAPHOR_THEMES[themeIndex];
};

export interface SajuFortunePromptInput {
  recipient: SajuFortuneRecipient;
  todayKst: string;
  todayPillar: string;
  yearMonthPillars: YearMonthPillars;
}

// 일진과 해석 근거(오행 분포·십성·충합)는 코드가 계산해 넣는다 — 모델은 그 사실을 풀어 쓰기만 한다.
// 다시 계산하지 말라고 못박는 이유는 dayPillarOf·saju-analysis 주석 참조.
export const buildSajuFortunePrompt = ({
  recipient,
  todayKst,
  todayPillar,
  yearMonthPillars,
}: SajuFortunePromptInput): string => {
  const natal = recipient.natalPillars
    .map(
      (pillar, index) =>
        `${PILLAR_LABELS[index]} ${pillarToHangul(pillar)}(${pillar})`,
    )
    .join(', ');
  const hourNote =
    recipient.natalPillars.length < PILLAR_LABELS.length
      ? ' (태어난 시각을 몰라 시주는 없다. 시주를 추측하지 마라.)'
      : '';

  return [
    '너는 사주를 전혀 모르는 친한 사람에게 매일 아침 그날의 운세를 풀어서 보내 주는 역할이다.',
    '',
    `- 받는 사람: ${recipient.name}`,
    `- 타고난 사주: ${natal}${hourNote}`,
    `- 오늘: ${todayKst}, 오늘 일진: ${pillarToHangul(todayPillar)}(${todayPillar})일 (이미 확정된 값이다. 다시 계산하지 말고 그대로 써라.)`,
    `- 오늘의 비유 소재: ${metaphorThemeOf(todayKst)}`,
    '',
    '계산된 사실 (코드가 확정한 값이다. 다시 계산하지 말고 이것만 근거로 써라):',
    ...formatSajuFacts(
      analyzeSajuDay(recipient.natalPillars, todayPillar, yearMonthPillars),
    ),
    '',
    '작성 형식 (이 순서 그대로, 운세 본문은 12줄 이내):',
    '- 첫 줄: 오늘이 어떤 날인지 한 문장으로. 오늘의 비유 소재를 빌려 그린다.',
    // 항목 줄은 코드가 굵은 라벨·별과 함께 한 덩어리씩 띄워 그린다 — 길면 휴대폰에서 덩어리가 무거워진다.
    '- 빈 줄 하나 뒤에 다섯 줄: "총운:", "일·공부:", "사람 관계:", "돈:", "컨디션:" 으로 시작하고 각 짧은 한 문장(50자 안팎). 오늘 해 볼 만한 구체적인 행동 하나를 중심으로 쓰고, 이유는 생활 언어로 짧게 붙인다. 나무·불·흙·쇠·물 같은 기운 이름은 "총운:" 에서만 쓴다.',
    // 흐름 사실을 항목마다 끌어 쓰면 매일 같은 문장이 된다 — 한 달 내내 같은 값이라서다.
    '- 올해·이번 달의 흐름은 "총운:" 에서만 한 번 짧게 엮는다. 오늘 기운이 그 흐름과 어떻게 만나는지로 쓴다.',
    '- 빈 줄 하나 뒤에 "행운 포인트:" 한 줄(오늘의 행운 기운을 살린 작은 행동 하나), 이어서 "오늘의 한 마디:" 한 줄.',
    '- 빈 줄 하나 뒤에 카드 두 줄을 붙인다. 이 두 줄은 받는 사람에게 보이지 않고 운세 카드 그림을 그리는 데만 쓴다.',
    `  ${CARD_TITLE_LABEL} 오늘 운세를 상징하는 타로 카드 이름. 영어 대문자 2~4단어(예: THE STEADY RIVER).`,
    `  ${CARD_SCENE_LABEL} 그 카드에 그릴 장면을 영어 한두 문장으로. 사람 얼굴과 글자는 넣지 않는다.`,
    '',
    '작성 규칙:',
    '- 받는 사람의 타고난 기운을 소개하는 말("너는 ~ 기운을 타고났어")로 시작하지 않는다. 매일 같은 소개가 반복되면 안 된다. 타고난 기운은 오늘 기운과 엮어 꼭 필요할 때만 짧게 언급한다.',
    '- 한자를 한 글자도 쓰지 않는다. 간지·오행은 한글로만 쓴다(예: 계해일, 물 기운, 흙 기운).',
    '- 편재·식신·충·극·합 같은 명리 용어는 한 번도 쓰지 않는다. 대신 쉬운 말로 쓴다(예: "부딪힌다", "북돋아 준다").',
    '- 사실에 없는 관계(부딪힘·맞물림 등)를 지어내지 않는다. 타고난 사주의 기둥을 본문에 다시 나열하지 않는다.',
    '- 재미로 보는 운세 말투(반말, 다정하게)로 쓴다. 사고·질병·금전 손실을 단정하거나 겁주는 말은 쓰지 않는다.',
    '- "별점 결" 사실에서 "조심할 날"인 항목에는 "그럴 땐 이렇게 해 봐" 식의 대처를 꼭 함께 쓴다. 별점·숫자는 쓰지 않는다(코드가 따로 붙인다).',
    '- 평문으로 쓴다. 제목·표·코드블록은 쓰지 않고, 이모지는 줄 머리에 하나까지만 쓴다. 🍀 이모지는 쓰지 않는다.',
  ].join('\n');
};
