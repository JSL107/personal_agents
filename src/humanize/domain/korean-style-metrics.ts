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
  // 비율은 0~100 정수 퍼센트다. 소수 1자리로 반올림하면 0~5% 가 전부 0 으로 뭉개져
  // "구어 어미가 하나도 없다" 로 읽힌다(실측: 142문장 중 6개 = 4% 가 0% 로 표시됐다).
  shortSentencePercent: number;
  longestSentenceLength: number;
  colloquialEndingPercent: number;
  // 종결 어미 중 `~요` 로 끝나는 비율. 프로파일 실측은 "`~습니다` 와 `~요` 가 거의 반반이고,
  // 여기에 구어 어미가 6분의 1쯤 얹힌다" 다 — 즉 문체는 두 축이고, 구어 어미는 `~요` 축의
  // 부분집합이다. 이 축이 없으면 `~에요`·`~봐요` 로 쓴 글이 "구어 6%" 로만 보여 딱딱한 글로
  // 오독된다(실측: 발행본 2026-08-19-http-cache 가 그랬다).
  yoEndingPercent: number;
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
 * 4문장 이상이었고, **아래 기준(3문장 이상 · 공백 제외)으로 짧은 문장이 없는 문단이 11개**였다.
 * 짧은 문장이 몇몇 문단에 몰려 전체 비율만 채운 것이다. 평균으로 뭉개면 이 편중이 보이지 않는다.
 */
export type KoreanStyleParagraphMetrics = {
  paragraphCount: number;
  // 4문장 이상 또는 150자 초과 — 화면에서 벽으로 떨어지는 문단의 비율(0~100 정수 퍼센트).
  // 소수 비율로 담지 않는 이유는 위 shortSentencePercent 와 같다. 25문단 중 1개(0.04)가
  // 0 으로 뭉개지면 남은 벽을 드러내려고 만든 지표가 벽을 숨긴다.
  wallPercent: number;
  // 3문장 이상인데 짧은 문장(20자 이하)이 한 개도 없는 문단 수. 호흡이 쉴 자리가 없는 덩어리다.
  //
  // 왜 2문장 문단은 세지 않는가 — J-5 처방으로 문단을 잘게 나누면 2문장 문단이 늘어나는데,
  // 거기까지 짧은 문장을 요구하면 처방을 따를수록 지표가 나빠진다. 호흡이 실제로 문제되는 것은
  // 문장이 여럿 이어지는 덩어리다.
  noShortSentenceParagraphs: number;
};

const SHORT_SENTENCE_MAX = 20;
// 프로파일의 구어 종결어미. 이유를 문장 끊고 뒤에 던지는 이 문체의 표식이다.
//
// 이 목록에 `~에요`·`~아요` 를 넣지 않는다. 그 둘은 이유를 던지는 어미가 아니라 해요체 평서형이라
// 다른 축이고(→ yoEndingPercent), 기준값 16.5% 가 이 목록으로 실측된 것이라 늘리면 그 기준이
// 무효가 된다. 축을 섞지 말고 나란히 둔다.
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
// 합쇼체 종결 판정. `습니다` 를 나열하지 않고 `니다` 로 본다 — 합쇼체는 자음 뒤에서 `-습니다`,
// 모음 뒤에서 `-ㅂ니다` 로 갈려 "씁니다·갑니다·봅니다" 처럼 활용형이 무한하다. 어미를 열거하면
// 정확히 그 활용형들이 빠져 합쇼체가 0 으로 세어진다(실측으로 걸렸다).
// 한계: "아니다" 같은 반말 평서형도 걸린다. 존댓말로 쓰는 이 문체에서는 나오지 않아 감수한다.
const FORMAL_ENDING = '니다';
// `~요` 와 합쇼체만 세고 나머지(명사 종결·인용·목록)는 분모에서 뺀다 — 분모에 넣으면 불릿이
// 많은 글의 종결체 비율이 통째로 내려가 축이 무의미해진다.
// 문단 벽 임계. 문장 길이와 달리 **공백을 포함해** 센다 — 이 지표가 재는 것은 어휘량이 아니라
// 화면에서 덩어리가 차지하는 면적이고, 거기엔 공백도 자리를 차지한다.
const PARAGRAPH_WALL_SENTENCE_MIN = 4;
const PARAGRAPH_WALL_LENGTH_MAX = 150;
const NO_SHORT_SENTENCE_MIN = 3;

// 마크다운에서 산문 문단만 골라 문장으로 자른다. 코드·표·헤딩이 섞이면 문장 길이 분포가
// 통째로 왜곡되므로 윤문 대상과 **같은 분해기**를 쓴다.
// 문장 끝에 붙는 닫는 문자. 마침표 뒤에 인용·강조가 오는 문장이 실제 본문에 흔하다
// (`"이 정도면 되겠지" 하고`, `**이렇게 해요.**`). 이걸 빼놓으면 두 곳이 함께 어긋난다 —
// 문장 분리가 안 돼 두 문장이 하나로 합쳐지고, 종결 어미 판정도 닫는 문자에 막혀 누락된다.
// 스마트 인용부호(“ ” ‘ ’)와 마크다운 강조(* _), 한글 인용부호(」 』)까지 함께 본다.
const CLOSING_CHARS = '"\'`)\\]*_”’」』';
const TRAILING_CLOSERS = new RegExp(`[.!?。${CLOSING_CHARS}]+$`);
const SENTENCE_BOUNDARY = new RegExp(
  `(?<=[.!?。][${CLOSING_CHARS}]*)\\s+|\\n+`,
);

// 문장 끝의 마침표·인용·강조를 걷어낸다. 종결 어미를 보는 모든 자리가 이 함수를 지나야
// 한 쪽만 고쳐져 지표가 갈리는 일이 없다.
const stripSentenceTail = (sentence: string): string =>
  sentence.replace(TRAILING_CLOSERS, '');

export const extractProseSentences = (markdown: string): string[] => {
  const { lines, blocks } = scanMarkdownBlocks(markdown);
  const prose = blocks
    .filter((block) => block.kind === 'prose')
    .map((block) => lines.slice(block.startLine, block.endLine + 1).join(' '))
    .join(' ');

  return prose
    .split(SENTENCE_BOUNDARY)
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
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

const measureParagraphs = (markdown: string): KoreanStyleParagraphMetrics => {
  const paragraphs = extractProseParagraphs(markdown);
  if (paragraphs.length === 0) {
    return {
      paragraphCount: 0,
      wallPercent: 0,
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
    wallPercent: toPercent(wallCount, paragraphs.length),
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
      shortSentencePercent: 0,
      longestSentenceLength: 0,
      colloquialEndingPercent: 0,
      yoEndingPercent: 0,
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
      stripSentenceTail(sentence).endsWith(ending),
    ),
  ).length;

  // 종결체 두 축.
  const yoCount = sentences.filter((sentence) =>
    stripSentenceTail(sentence).endsWith('요'),
  ).length;
  const formalCount = sentences.filter((sentence) =>
    stripSentenceTail(sentence).endsWith(FORMAL_ENDING),
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
    shortSentencePercent: toPercent(
      lengths.filter((length) => length <= SHORT_SENTENCE_MAX).length,
      lengths.length,
    ),
    longestSentenceLength: Math.max(...lengths),
    colloquialEndingPercent: toPercent(colloquialCount, sentences.length),
    yoEndingPercent:
      yoCount + formalCount === 0
        ? 0
        : toPercent(yoCount, yoCount + formalCount),
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
  const head = `문체 지표: 문장 ${metrics.sentenceCount}개 · 편차 ${metrics.lengthStandardDeviation} · 짧은문장 ${metrics.shortSentencePercent}% · 최장 ${metrics.longestSentenceLength}자 · 구어 ${metrics.colloquialEndingPercent}% · 요체 ${metrics.yoEndingPercent}% · 금지접속사 ${metrics.bannedConnectiveCount}회`;
  const paragraph = `문단 ${metrics.paragraph.paragraphCount}개 · 벽 ${metrics.paragraph.wallPercent}% · 짧은문장 없는 문단 ${metrics.paragraph.noShortSentenceParagraphs}개`;
  // 참고값 단서는 문장 축 이야기다. 문단 줄 뒤에 붙이면 문단 지표까지 참고값이라는 오해를 부른다.
  const sentenceLine = metrics.measurable
    ? head
    : `${head} (40문장 미만이라 참고값)`;
  return `${sentenceLine}\n${paragraph}`;
};

const round = (value: number): number => Math.round(value * 10) / 10;

const toPercent = (count: number, total: number): number =>
  Math.round((count / total) * 100);
