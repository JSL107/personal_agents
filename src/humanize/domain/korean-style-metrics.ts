import { scanMarkdownBlocks } from './markdown-blocks';

// 윤문본이 "이 사람 말투" 에 얼마나 가까운지 재는 지표.
//
// 출처: `~/.claude/skills/humanize-korean/references/style-profile-juneseok.md`
// (「이대리 프로젝트」소개 글 본문 115문장 실측). 수치는 목표가 아니라 **재현 대상**이다.
//
// 왜 상한만 보지 않고 하한을 함께 두는가 — 상한만 두면 구어 어미 0%인 전형적 AI 문체가
// 그대로 통과한다. 왜 표준편차만 보지 않는가 — 159자 만연체 하나가 섞인 글이 편차만으로는
// 통과해버린 사례가 있어 **최장 문장 상한과 AND 조건**으로 본다.
//
// 이 지표는 지금 발행을 막지 않는다. 카드에 수치를 적어 눈으로 보게 하는 용도다 —
// 차단 임계값은 실제 발행본을 몇 편 쌓아 분포를 본 뒤에 정할 일이다.

export type KoreanStyleMetrics = {
  sentenceCount: number;
  averageLength: number;
  lengthStandardDeviation: number;
  shortSentenceRatio: number;
  longestSentenceLength: number;
  colloquialEndingRatio: number;
  bannedConnectiveCount: number;
  // 40문장 미만이면 문장 하나가 비율을 10%p씩 흔들어 정량 판정이 무의미하다.
  measurable: boolean;
  paragraph: KoreanStyleParagraphMetrics;
};

/**
 * 문단 축. 문서 전체 평균이 통과해도 개별 문단은 벽일 수 있다.
 *
 * 실측(run #980 `2026-08-20-agent-security-permission-boundaries`): 문서 지표는 네 항목 모두
 * 통과했는데(편차 15.2 · 짧은문장 20% · 구어 10% · 금지접속사 0) 산문 문단 25개 중 20개가
 * 4문장 이상이었고, **짧은 문장이 하나도 없는 문단이 17개**였다. 짧은 문장이 몇몇 문단에
 * 몰려 전체 비율만 채운 것이다. 평균으로 뭉개면 이 편중이 보이지 않는다.
 */
export type KoreanStyleParagraphMetrics = {
  paragraphCount: number;
  // 4문장 이상 또는 150자 초과 — 화면에서 벽으로 떨어지는 문단의 비율.
  wallRatio: number;
  // 3문장 이상인데 짧은 문장(20자 이하)이 한 개도 없는 문단 수. 호흡이 쉴 자리가 없는 덩어리다.
  //
  // 왜 2문장 문단은 세지 않는가 — J-5 처방으로 문단을 잘게 나누면 2문장 문단이 늘어나는데,
  // 거기까지 짧은 문장을 요구하면 처방을 따를수록 지표가 나빠진다. 호흡이 실제로 문제되는 것은
  // 문장이 여럿 이어지는 덩어리다.
  noShortSentenceParagraphs: number;
};

const SHORT_SENTENCE_MAX = 20;
// 프로파일의 구어 종결어미. 이유를 문장 끊고 뒤에 던지는 이 문체의 표식이다.
const COLLOQUIAL_ENDINGS = [
  '니까요',
  '거든요',
  '더라고요',
  '잖아요',
  '죠',
  '네요',
];
// 이 문체가 쓰지 않는 접속사. 하나라도 있으면 AI 문체 쪽으로 끌린 신호다.
const BANNED_CONNECTIVES = [
  '또한',
  '따라서',
  '게다가',
  '뿐만 아니라',
  '즉,',
  '한편',
];
const MEASURABLE_SENTENCE_MIN = 40;
// 문단 벽 임계. 문장 길이와 달리 **공백을 포함해** 센다 — 이 지표가 재는 것은 어휘량이 아니라
// 화면에서 덩어리가 차지하는 면적이고, 거기엔 공백도 자리를 차지한다.
const PARAGRAPH_WALL_SENTENCE_MIN = 4;
const PARAGRAPH_WALL_LENGTH_MAX = 150;
const NO_SHORT_SENTENCE_MIN = 3;

// 마크다운에서 산문 문단만 골라 문장으로 자른다. 코드·표·헤딩이 섞이면 문장 길이 분포가
// 통째로 왜곡되므로 윤문 대상과 **같은 분해기**를 쓴다.
export const extractProseSentences = (markdown: string): string[] => {
  const { lines, blocks } = scanMarkdownBlocks(markdown);
  const prose = blocks
    .filter((block) => block.kind === 'prose')
    .map((block) => lines.slice(block.startLine, block.endLine + 1).join(' '))
    .join(' ');

  return prose
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
};

// 산문 문단을 그대로(합치지 않고) 꺼낸다. 윤문 어댑터가 모델에 넘기는 단위와 같아야
// "몇 번째 문단이 벽인가"가 카드의 `N/M문단 적용` 과 같은 축에서 읽힌다.
export const extractProseParagraphs = (markdown: string): string[] => {
  const { lines, blocks } = scanMarkdownBlocks(markdown);

  return blocks
    .filter((block) => block.kind === 'prose')
    .map((block) =>
      lines
        .slice(block.startLine, block.endLine + 1)
        .join(' ')
        .trim(),
    )
    .filter((paragraph) => paragraph.length > 0);
};

const splitSentences = (text: string): string[] =>
  text
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

const measureParagraphs = (markdown: string): KoreanStyleParagraphMetrics => {
  const paragraphs = extractProseParagraphs(markdown);
  if (paragraphs.length === 0) {
    return {
      paragraphCount: 0,
      wallRatio: 0,
      noShortSentenceParagraphs: 0,
    };
  }

  let wallCount = 0;
  let noShortCount = 0;
  for (const paragraph of paragraphs) {
    const sentences = splitSentences(paragraph);
    if (
      sentences.length >= PARAGRAPH_WALL_SENTENCE_MIN ||
      paragraph.length > PARAGRAPH_WALL_LENGTH_MAX
    ) {
      wallCount += 1;
    }
    const hasShort = sentences.some(
      (sentence) => sentence.replace(/\s/g, '').length <= SHORT_SENTENCE_MAX,
    );
    if (sentences.length >= NO_SHORT_SENTENCE_MIN && !hasShort) {
      noShortCount += 1;
    }
  }

  return {
    paragraphCount: paragraphs.length,
    wallRatio: round(wallCount / paragraphs.length),
    noShortSentenceParagraphs: noShortCount,
  };
};

export const measureKoreanStyle = (markdown: string): KoreanStyleMetrics => {
  const sentences = extractProseSentences(markdown);
  if (sentences.length === 0) {
    return {
      sentenceCount: 0,
      averageLength: 0,
      lengthStandardDeviation: 0,
      shortSentenceRatio: 0,
      longestSentenceLength: 0,
      colloquialEndingRatio: 0,
      bannedConnectiveCount: 0,
      measurable: false,
      paragraph: measureParagraphs(markdown),
    };
  }

  // 길이는 공백을 제외해 센다 — 프로파일 실측과 같은 기준이어야 값이 비교 가능하다.
  const lengths = sentences.map(
    (sentence) => sentence.replace(/\s/g, '').length,
  );
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const average = total / lengths.length;
  const variance =
    lengths.reduce((sum, length) => sum + (length - average) ** 2, 0) /
    lengths.length;

  const colloquialCount = sentences.filter((sentence) =>
    COLLOQUIAL_ENDINGS.some((ending) =>
      sentence.replace(/[.!?"'`)\]]+$/g, '').endsWith(ending),
    ),
  ).length;

  const bannedConnectiveCount = BANNED_CONNECTIVES.reduce(
    (count, connective) =>
      count +
      sentences.filter((sentence) => sentence.includes(connective)).length,
    0,
  );

  return {
    sentenceCount: sentences.length,
    averageLength: round(average),
    lengthStandardDeviation: round(Math.sqrt(variance)),
    shortSentenceRatio: round(
      lengths.filter((length) => length <= SHORT_SENTENCE_MAX).length /
        lengths.length,
    ),
    longestSentenceLength: Math.max(...lengths),
    colloquialEndingRatio: round(colloquialCount / sentences.length),
    bannedConnectiveCount,
    measurable: sentences.length >= MEASURABLE_SENTENCE_MIN,
    paragraph: measureParagraphs(markdown),
  };
};

// 카드 한 줄로 적는 요약. 판정이 아니라 관측값이라는 게 드러나야 한다.
export const formatKoreanStyleMetrics = (
  metrics: KoreanStyleMetrics,
): string => {
  if (metrics.sentenceCount === 0) {
    return '문체 지표: 측정할 산문이 없음';
  }
  const head = `문체 지표: 문장 ${metrics.sentenceCount}개 · 편차 ${metrics.lengthStandardDeviation} · 짧은문장 ${Math.round(
    metrics.shortSentenceRatio * 100,
  )}% · 최장 ${metrics.longestSentenceLength}자 · 구어 ${Math.round(
    metrics.colloquialEndingRatio * 100,
  )}% · 금지접속사 ${metrics.bannedConnectiveCount}회`;
  const paragraph = `문단 ${metrics.paragraph.paragraphCount}개 · 벽 ${Math.round(
    metrics.paragraph.wallRatio * 100,
  )}% · 짧은문장 없는 문단 ${metrics.paragraph.noShortSentenceParagraphs}개`;
  const sentenceLine = metrics.measurable
    ? head
    : `${head} (40문장 미만이라 참고값)`;
  return `${sentenceLine}\n${paragraph}`;
};

const round = (value: number): number => Math.round(value * 10) / 10;
