import { pillarToHangul } from './day-pillar';
import {
  analyzeSajuDay,
  formatSajuFacts,
  YearMonthPillars,
} from './saju-analysis';
import { SajuFortuneRecipient } from './saju-fortune-cron.type';

// 아침 운세 DM 의 첫 줄. 스레드 대화가 이 줄로 "운세 메시지에 단 답글" 을 알아보므로
// 발송과 판별이 같은 함수·패턴을 쓴다 — 한쪽만 바뀌면 판별이 조용히 끊긴다.
export const formatFortuneHeader = (
  todayKst: string,
  todayPillar: string,
): string =>
  `🔮 *오늘의 운세 — ${todayKst} (${pillarToHangul(todayPillar)}일)*`;

// CJK 통합 한자. 받는 사람이 읽지 못한 「己土는 오늘 癸水를…」 같은 응답을 거른다.
export const HANJA_PATTERN = /[\u4E00-\u9FFF]/;

// 첫 줄 맨 앞에 고정한다 — 일반 답변이 머리말을 인용한 스레드를 가로채지 않게. Slack 이 돌려주는 text 는
// 이모지를 `:crystal_ball:` 단축 코드로, 굵게 표식을 다르게 바꿔 올 수 있어 그 두 군데만 느슨하게 본다.
const FORTUNE_HEADER_PATTERN =
  /^(?:🔮|:crystal_ball:)\s*\*?오늘의 운세 — (\d{4}-\d{2}-\d{2}) \(/;

// 운세 DM 이면 그날 날짜('YYYY-MM-DD'), 아니면 undefined.
export const fortuneDateOf = (messageText: string): string | undefined =>
  FORTUNE_HEADER_PATTERN.exec(messageText.split('\n')[0])?.[1];

export interface FortuneChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface FortuneFollowUpPromptInput {
  recipient: SajuFortuneRecipient;
  fortuneDate: string;
  fortunePillar: string;
  // 아침 운세와 같은 날짜로 계산한 값이어야 한다 — 다르면 답이 아침 운세와 다른 흐름을 근거로 삼는다.
  yearMonthPillars: YearMonthPillars;
  // 아침에 보낸 운세 DM 원문(헤더 포함). 답이 아침 운세와 어긋나지 않게 근거로 준다.
  originalFortune: string;
  priorTurns: FortuneChatTurn[];
  question: string;
}

// 스레드 앞 대화는 최근 것만 싣는다 — 길어지면 아침 운세·사실이 프롬프트에서 묻힌다.
const MAXIMUM_PRIOR_TURNS = 10;

export const buildFortuneFollowUpPrompt = ({
  recipient,
  fortuneDate,
  fortunePillar,
  yearMonthPillars,
  originalFortune,
  priorTurns,
  question,
}: FortuneFollowUpPromptInput): string => {
  const turns = priorTurns
    .slice(-MAXIMUM_PRIOR_TURNS)
    .map(
      ({ role, text }) =>
        `${role === 'user' ? recipient.name : '너'}: ${text.trim()}`,
    );
  return [
    '너는 아침에 보낸 운세를 두고 친한 사람과 이어서 이야기하는 역할이다. 받는 사람은 사주를 전혀 모른다.',
    '',
    `- 받는 사람: ${recipient.name}`,
    `- 운세 날짜: ${fortuneDate}, 그날 일진: ${pillarToHangul(fortunePillar)}일 (확정값이다. 다시 계산하지 마라.)`,
    '',
    '계산된 사실 (코드가 확정한 값이다. 이것만 근거로 써라):',
    ...formatSajuFacts(
      analyzeSajuDay(recipient.natalPillars, fortunePillar, yearMonthPillars),
    ),
    '',
    '아침에 보낸 운세:',
    originalFortune.trim(),
    '',
    ...(turns.length > 0 ? ['이 스레드의 앞선 대화:', ...turns, ''] : []),
    `${recipient.name}의 질문: ${question.trim()}`,
    '',
    '답변 규칙:',
    '- 질문에 바로 답한다. 길이는 질문에 맞게 2~6줄. 아침 운세를 다시 요약하지 않는다.',
    '- 답의 근거는 위 계산된 사실과 아침 운세다. 아침 운세와 반대되는 말을 하지 않고, 사실에 없는 관계를 지어내지 않는다.',
    '- 아침 메시지에 없는 별점이나 숫자를 새로 지어내지 않는다.',
    '- 근거를 쉬운 말로 한 번 덧붙이고, 오늘 해 볼 수 있는 구체적인 행동을 하나 권한다.',
    '- 운세로 알 수 없는 것(시험 합격·투자 종목·특정 사람의 속마음 등)을 물으면 재미로 보는 운세라는 선을 지키며 오늘의 기운에 빗대어 가볍게 답한다. 단정하지 않는다.',
    '- 한자를 한 글자도 쓰지 않는다. 편재·식신·충·극·합 같은 명리 용어를 쓰지 않는다.',
    '- 반말로 다정하게 쓴다. 사고·질병·금전 손실을 단정하거나 겁주는 말은 쓰지 않는다. 건강이 걱정되는 질문이면 필요할 때 전문가에게 확인해 보라고 덧붙인다.',
    '- 평문으로 쓴다. 제목·표·코드블록은 쓰지 않는다.',
  ].join('\n');
};
