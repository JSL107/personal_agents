import { pillarToHangul } from './day-pillar';
import { analyzeSajuDay, formatSajuFacts } from './saju-analysis';
import { SajuFortuneRecipient } from './saju-fortune-cron.type';

const PILLAR_LABELS = ['년주', '월주', '일주', '시주'];

export interface SajuFortunePromptInput {
  recipient: SajuFortuneRecipient;
  todayKst: string;
  todayPillar: string;
}

// 일진과 해석 근거(오행 분포·십성·충합)는 코드가 계산해 넣는다 — 모델은 그 사실을 풀어 쓰기만 한다.
// 다시 계산하지 말라고 못박는 이유는 dayPillarOf·saju-analysis 주석 참조.
export const buildSajuFortunePrompt = ({
  recipient,
  todayKst,
  todayPillar,
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
    '',
    '계산된 사실 (코드가 확정한 값이다. 다시 계산하지 말고 이것만 근거로 써라):',
    ...formatSajuFacts(analyzeSajuDay(recipient.natalPillars, todayPillar)),
    '',
    '작성 규칙:',
    '- 한자를 한 글자도 쓰지 않는다. 간지·오행은 한글로만 쓴다(예: 계해일, 물 기운, 흙 기운).',
    '- 편재·식신·충·극·합 같은 명리 용어는 한 번도 쓰지 않는다. 대신 쉬운 말로 쓴다(예: "부딪힌다", "북돋아 준다").',
    '- 첫 문단(2~3문장): 받는 사람의 타고난 기운(일간을 오행으로 — 예: "단단한 쇠 기운")과 오늘 날의 기운이 어떻게 만나는지 비유로 쉽게 설명한다.',
    '- 이어서 총운, 일, 사람 관계, 조심할 것을 각각 1~2문장으로 쓴다. 항목마다 위 계산된 사실 중 하나를 근거로 삼아 "왜 그런지"를 쉬운 말로 덧붙인다. 사실에 없는 관계(부딪힘·맞물림 등)를 지어내지 않는다.',
    '- 마지막 줄에 오늘의 한 마디를 쓴다. 전체 10줄 이내.',
    '- 타고난 사주의 기둥을 본문에 다시 나열하지 않는다.',
    '- 재미로 보는 운세 말투(반말, 다정하게)로 쓴다. 사고·질병·금전 손실을 단정하거나 겁주는 말은 쓰지 않는다.',
    '- 평문으로 쓴다. 제목·표·코드블록은 쓰지 않고, 이모지는 줄 머리에 하나까지만 쓴다.',
  ].join('\n');
};
