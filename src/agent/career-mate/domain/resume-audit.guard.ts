import {
  AuditItem,
  AuditStatus,
  CareerProfileData,
  ResumeAuditData,
  ResumeAuditResult,
} from './career-mate.type';

const STATUS_ORDER: Record<AuditStatus, number> = {
  MISSING: 0,
  WEAK: 1,
  UNJUDGED: 2,
  PROVEN: 3,
};

const normalizeForQuote = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

// 프롬프트는 원문을 "결과: ..." 처럼 라벨과 함께 보여준다. 그래서 quote 가 라벨을 머금고 오는
// 것은 정상이고, 원문 대조는 라벨을 포함한 채로 해야 오강등이 없다.
//
// 다만 그 대조만으로는 라벨 하나("결과: ")나 원문의 단어 몇 글자("결과")도 부분문자열 검사를
// 그냥 통과한다 — 근거를 하나도 담지 않은 채 PROVEN 이 유지되는, 이 가드가 막으려던 관대한
// 판정의 정확히 그 형태다. 그래서 길이는 라벨을 벗긴 본문으로 따로 잰다(줄마다 합산).
const QUOTE_LABEL_PATTERN = /^(상황|과제|행동|결과|기술|근거)\s*:\s*/;
const MIN_QUOTE_BODY_LENGTH = 6;

const toQuoteBody = (value: string): string =>
  normalizeForQuote(value).replace(QUOTE_LABEL_PATTERN, '').trim();

export const applyAuditGuards = (
  data: ResumeAuditData,
  profile: CareerProfileData,
): ResumeAuditResult => {
  const accomplishmentByTitle = new Map(
    profile.accomplishments.map((accomplishment) => [
      accomplishment.title,
      accomplishment,
    ]),
  );
  const demotedTitles: string[] = [];
  const droppedTitles: string[] = [];
  const forcedMissing: string[] = [];
  const guardedItems: AuditItem[] = [];

  for (const item of data.items) {
    const accomplishment = accomplishmentByTitle.get(item.title);
    if (!accomplishment) {
      droppedTitles.push(item.title);
      continue;
    }
    let guarded = { ...item };
    if (guarded.status === 'PROVEN') {
      const source = normalizeForQuote(
        [
          accomplishment.bullet,
          `상황: ${accomplishment.star.situation}`,
          `과제: ${accomplishment.star.task}`,
          `행동: ${accomplishment.star.action}`,
          `결과: ${accomplishment.star.result}`,
        ].join(' '),
      );
      // 모델은 원문의 필요한 줄만 골라 개행으로 이어 붙여 인용한다(실측 25건 중 13건).
      // quote 를 한 덩어리로 원문과 대조하면 중간에 건너뛴 줄 때문에 정당한 인용이 전부
      // 강등된다(실측: PROVEN 11건 전원). 그래서 줄 단위로 쪼개 각 줄을 대조한다.
      const quoteLines = guarded.quote
        .split(/\r?\n/)
        .map((line) => normalizeForQuote(line))
        .filter((line) => line.length > 0);
      const quoteBodyLength = quoteLines.reduce(
        (total, line) => total + toQuoteBody(line).length,
        0,
      );
      const everyLineQuoted =
        quoteLines.length > 0 &&
        quoteLines.every((line) => source.includes(line));
      if (quoteBodyLength < MIN_QUOTE_BODY_LENGTH || !everyLineQuoted) {
        guarded = {
          ...guarded,
          status: 'WEAK',
          why: `[근거 인용 실패] ${guarded.why}`,
        };
        demotedTitles.push(guarded.title);
      }
    }
    if (accomplishment.evidence.length === 0) {
      guarded = { ...guarded, status: 'MISSING' };
      forcedMissing.push(guarded.title);
    }
    guardedItems.push(guarded);
  }

  const judgedTitles = new Set(guardedItems.map((item) => item.title));
  const unjudgedTitles = profile.accomplishments
    .filter((accomplishment) => !judgedTitles.has(accomplishment.title))
    .map((accomplishment) => accomplishment.title);
  for (const title of unjudgedTitles) {
    guardedItems.push({
      title,
      status: 'UNJUDGED',
      quote: '',
      why: '모델이 이 성과를 판정하지 않았습니다.',
      rewrite: null,
    });
  }

  guardedItems.sort(
    (left, right) => STATUS_ORDER[left.status] - STATUS_ORDER[right.status],
  );

  return {
    ...data,
    items: guardedItems,
    guard: {
      demotedTitles,
      droppedTitles,
      unjudgedTitles,
      forcedMissing,
    },
    // 목표 공고의 출처는 저장소를 읽는 application layer 에서 덮어쓴다. guard 는 이력서
    // 원문만으로 결정할 수 있는 판정에 한정한다.
    jdSource: null,
  };
};
