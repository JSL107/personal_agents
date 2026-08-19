import {
  AuditHighlight,
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
const MAX_HIGHLIGHTS = 3;

// 앞세울 성과는 가드를 통과한 PROVEN 에서만 고른다. 모델은 자기가 PROVEN 이라 쓴 항목을
// 기준으로 highlights 를 채우는데, 그 판정은 뒤이어 근거 인용 대조·근거 PR 유무로 강등될 수
// 있다. 강등된 성과를 그대로 앞세우면 같은 카드가 "근거 없음" 과 "이걸 맨 위에" 를 동시에
// 말하게 된다.
const selectHighlights = (
  highlights: AuditHighlight[],
  guardedItems: AuditItem[],
): { kept: AuditHighlight[]; dropped: string[] } => {
  const provenTitles = new Set(
    guardedItems
      .filter((item) => item.status === 'PROVEN')
      .map((item) => item.title),
  );
  const kept: AuditHighlight[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const highlight of highlights) {
    if (
      !provenTitles.has(highlight.title) ||
      seen.has(highlight.title) ||
      kept.length >= MAX_HIGHLIGHTS
    ) {
      dropped.push(highlight.title);
      continue;
    }
    seen.add(highlight.title);
    kept.push(highlight);
  }
  return { kept, dropped };
};

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
  const rewriteMissing: string[] = [];
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
      // why 도 함께 갈아끼운다. 모델은 이 항목을 입증됐다고 보고 그 근거를 why 에 썼는데,
      // status 만 뒤집으면 "[근거없음] … — 개선을 했다" 처럼 판정과 사유가 어긋난 줄이 남는다.
      guarded = {
        ...guarded,
        status: 'MISSING',
        why: `[근거 PR 없음] ${guarded.why}`,
      };
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

  // WEAK 인데 고쳐 쓸 문장이 없으면 사용자는 "약하다"만 듣고 무엇을 고칠지 못 받는다.
  // 파싱 단계에서 거부하지 않는 이유는 항목 하나의 누락으로 감사 전체를 잃기 때문이다 —
  // 대신 여기서 세어 드러낸다. MISSING 은 인용할 원문이 없어 rewrite 대상이 아니다.
  for (const item of guardedItems) {
    if (item.status === 'WEAK' && item.rewrite === null) {
      rewriteMissing.push(item.title);
    }
  }

  guardedItems.sort(
    (left, right) => STATUS_ORDER[left.status] - STATUS_ORDER[right.status],
  );

  const highlights = selectHighlights(data.highlights, guardedItems);

  return {
    ...data,
    items: guardedItems,
    highlights: highlights.kept,
    guard: {
      demotedTitles,
      droppedTitles,
      unjudgedTitles,
      forcedMissing,
      rewriteMissing,
      droppedHighlights: highlights.dropped,
    },
    // 목표 공고의 출처는 저장소를 읽는 application layer 에서 덮어쓴다. guard 는 이력서
    // 원문만으로 결정할 수 있는 판정에 한정한다.
    jdSource: null,
  };
};
