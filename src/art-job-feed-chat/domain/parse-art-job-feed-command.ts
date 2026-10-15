import {
  ArtJobKeywordKind,
  normalizeKeywordTerm,
  validateKeywordTerm,
} from '../../art-job-feed/domain/art-job-keyword';

type Action = 'ADD' | 'REMOVE';

export type ArtJobFeedCommand =
  // terms 는 「[캐주얼 / 북미풍] 관련 공고 찾아줘」처럼 함께 말한 키워드 — 가져오기에는 쓰지 않고 안내에만 쓴다.
  | { kind: 'FETCH'; terms: string[] }
  | { kind: 'LIST'; listKind?: ArtJobKeywordKind }
  | { kind: Action; listKind: ArtJobKeywordKind; terms: string[] }
  | { kind: 'NEEDS_LIST'; action: Action; terms: string[] }
  | { kind: 'NEEDS_TERMS'; action: Action; listKind?: ArtJobKeywordKind }
  | { kind: 'UNKNOWN' };

// 「제외해줘」는 제거가 아니라 추가로 읽는다 — "3D 제외해줘" 를 제거로 읽고 되물으면, 사용자가 "제외" 라고
// 답하는 순간 제외 목록에서 빼게 되어 뜻이 정반대가 된다. 어느 목록인지는 되묻는다.
const REMOVE_VERB = /제거|삭제|빼|지워|없애/;
const ADD_VERB =
  /추가|넣어|등록|포함|찾아(?:줘|줬으면)|걸러\s*내지\s*말|걸러줘|제외\s*해/;
const FETCH_VERB = /가져|올려|보내|받아|긁어/;
const LIST_VERB = /보여|조회|목록|뭐\s*있|알려|확인/;

export const parseArtJobFeedCommand = (text: string): ArtJobFeedCommand => {
  const normalized = text.trim();
  const listKind = findListKind(normalized);

  // 키워드를 말하지 않은 「공고 가져와·관련 공고 찾아줘·지금 줘봐」는 가져오기다.
  // 「공고」 없는 「지금줘봐」가 키워드 안내로 빠졌다(2026-10-15 16:19).
  if (
    !/키워드/.test(normalized) &&
    ((/공고/.test(normalized) &&
      (FETCH_VERB.test(normalized) || /찾아|보여/.test(normalized))) ||
      /지금\s*(?:공고|줘|보여|올려|가져|받)/.test(normalized))
  ) {
    return { kind: 'FETCH', terms: extractQuotedTerms(normalized) };
  }
  if (
    /키워드|허용|화풍|제외어|제외\s*목록|태그|그림체|스타일/.test(normalized) &&
    LIST_VERB.test(normalized) &&
    !ADD_VERB.test(normalized) &&
    !REMOVE_VERB.test(normalized)
  ) {
    return { kind: 'LIST', listKind };
  }

  const action: Action | null = REMOVE_VERB.test(normalized)
    ? 'REMOVE'
    : ADD_VERB.test(normalized)
      ? 'ADD'
      : null;
  const terms = extractTerms(normalized);
  if (action === null) {
    // 「'반실사' 키워드 제외(제목에 있으면 거르기)」처럼 동사 없이 키워드와 목록만 말하면 추가로 읽는다.
    // 빼는 쪽은 되돌리기 어려운 쪽이라 제거 동사가 있을 때만 한다.
    return terms.length > 0 && listKind !== undefined
      ? { kind: 'ADD', listKind, terms }
      : { kind: 'UNKNOWN' };
  }

  if (terms.length === 0) {
    return { kind: 'NEEDS_TERMS', action, listKind };
  }
  if (listKind === undefined) {
    return { kind: 'NEEDS_LIST', action, terms };
  }
  return { kind: action, listKind, terms };
};

export const mergeArtJobFeedCommands = (
  prior: ArtJobFeedCommand,
  current: ArtJobFeedCommand,
  currentText: string,
): ArtJobFeedCommand => {
  if (
    current.kind === 'FETCH' ||
    current.kind === 'LIST' ||
    current.kind === 'ADD' ||
    current.kind === 'REMOVE'
  ) {
    return current;
  }
  if (prior.kind === 'NEEDS_LIST') {
    // 이번 말에 자기 키워드가 있으면 되묻기의 답이 아니라 새 요청이다. 예전에는 합쳐서 직전 키워드를
    // 써 버렸다 — 「'반실사' 키워드 제외」가 직전 턴의 엉터리 키워드를 제외 목록에 넣었다(run 9099).
    if (extractTerms(currentText).length > 0) {
      return current;
    }
    // 봇이 보여 준 라벨을 「」로 감싸 답하는 경우가 있어 인용 안까지 본다. 목록을 둘 이상 고르면
    // 하나만 고르게 다시 묻는다(「허용 / 화풍 / 화풍에 추가」, 2026-10-15 16:05).
    const listKinds = findAnswerListKinds(currentText);
    if (listKinds.length > 1) {
      return { kind: 'NEEDS_LIST', action: prior.action, terms: prior.terms };
    }
    const listKind =
      (current.kind === 'NEEDS_TERMS' ? current.listKind : undefined) ??
      listKinds[0];
    return listKind === undefined
      ? current
      : { kind: prior.action, listKind, terms: prior.terms };
  }
  if (prior.kind === 'NEEDS_TERMS') {
    const terms =
      current.kind === 'NEEDS_LIST'
        ? current.terms
        : extractTerms(currentText).length > 0
          ? extractTerms(currentText)
          : /^[\p{L}\p{N}\s/-]{1,20}$/u.test(currentText.trim())
            ? [cleanTerm(currentText)]
            : [];
    const listKind =
      prior.listKind ??
      (current.kind === 'NEEDS_TERMS'
        ? current.listKind
        : findListKind(currentText));
    if (terms.length === 0) {
      return current;
    }
    return listKind === undefined
      ? { kind: 'NEEDS_LIST', action: prior.action, terms }
      : { kind: prior.action, listKind, terms };
  }
  return current;
};

// 인용한 키워드 안의 낱말은 목록 이름으로 보지 않는다 — 「허용에 "북미 스타일" 추가해줘」가 화풍으로 가면 안 된다(#849 리뷰).
const QUOTED_GROUP = /\[[^\]]+\]|「[^」]+」|"[^"]+"|'[^']+'/g;

const findListKind = (rawText: string): ArtJobKeywordKind | undefined => {
  const text = rawText.replace(QUOTED_GROUP, ' ');
  if (/화풍|태그|그림체|스타일/.test(text)) {
    return 'STYLE';
  }
  // 「제외해줘」의 제외는 동사라 목록으로 보지 않는다(어느 목록인지 되묻는다).
  if (/제외(?![하해한된시])|거를\s*키워드|걸러줘/.test(text)) {
    return 'EXCLUDED';
  }
  if (/허용|대상|제목\s*키워드/.test(text)) {
    return 'TARGET';
  }
  return undefined;
};

// 목록을 되물은 뒤의 답에 나온 목록 전부. 「제외」 단답도 목록 이름으로 본다.
const findAnswerListKinds = (text: string): ArtJobKeywordKind[] => {
  const kinds: ArtJobKeywordKind[] = [];
  if (/허용|대상/.test(text)) {
    kinds.push('TARGET');
  }
  if (/제외|거르/.test(text)) {
    kinds.push('EXCLUDED');
  }
  if (/화풍|태그|그림체|스타일/.test(text)) {
    kinds.push('STYLE');
  }
  return kinds;
};

const quotedGroups = (text: string): string[] =>
  [...text.matchAll(/\[([^\]]+)\]|「([^」]+)」|"([^"]+)"|'([^']+)'/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? match[4],
  );

const toTerms = (raw: string[]): string[] => [
  ...new Set(raw.map(cleanTerm).filter(isValidTerm)),
];

const extractQuotedTerms = (text: string): string[] =>
  toTerms(quotedGroups(text).flatMap((group) => group.split(/[/,·、]/)));

const extractTerms = (text: string): string[] => {
  const quoted = quotedGroups(text);
  return quoted.length > 0
    ? extractQuotedTerms(text)
    : toTerms(extractUnquotedTerms(text));
};

// 목록 이름 뒤 → 「<키워드> 키워드」 → 목록 이름 앞 → 동사 앞 순서로 보고, 실제 키워드가 하나라도 남는
// 첫 후보를 쓴다. 「허용 키워드에 2D 추가해줘」를 「<키워드> 키워드」로 먼저 읽으면 목록 이름 「허용」을
// 잡았다가 걸러져 키워드가 비어 버린다(#849 리뷰).
const UNQUOTED_TERM_PATTERNS: readonly RegExp[] = [
  /(?:허용|대상|제외어|제외|화풍|태그|그림체|스타일)(?:\s*(?:키워드|목록))?(?:에|에서|로|으로)?\s+([^\s]+)\s*(?:추가|넣어|등록|포함|제거|삭제|빼|지워|없애)/,
  /(?:^|\s)([^\s]+)\s*키워드/,
  /(?:^|\s)([^\s]+)\s*(?:화풍|태그|그림체|스타일|허용|제외어)/,
  /(?:^|\s)([^\s]+)\s*(?:추가|넣어|등록|포함|제거|삭제|빼|지워|없애|제외\s*해)/,
];

const extractUnquotedTerms = (text: string): string[] => {
  for (const pattern of UNQUOTED_TERM_PATTERNS) {
    const captured = text.match(pattern)?.[1];
    if (captured === undefined) {
      continue;
    }
    const candidates = captured.split(/[/,·、]/);
    if (candidates.map(cleanTerm).some(isValidTerm)) {
      return candidates;
    }
  }
  return [];
};

const cleanTerm = (raw: string): string => {
  const withoutParticle = raw.replace(
    /(?:에서|으로|에|도|를|을|은|는|이|가|로)$/u,
    '',
  );
  const term = normalizeKeywordTerm(withoutParticle);
  return /^(?:공고|해당|이|그|키워드|목록|화풍|태그|그림체|스타일|허용|제외|대상|함께|같이|좀|다시|또|더|그것|그거|이것|이거)$/.test(
    term,
  )
    ? ''
    : term;
};

// 봇이 보여 준 목록 라벨(「허용(제목에 있으면 받기)」 등)이나 그 조각은 키워드가 아니다(run 9099).
// 괄호 자체는 막지 않는다 — 「C++(언리얼)」 같은 정상 키워드가 있다(#850 리뷰).
const LIST_LABEL_FRAGMENT = /제목에\s*있으면|태그만|^(?:허용|제외|화풍)/;

const isValidTerm = (term: string): boolean =>
  validateKeywordTerm(term) === null && !LIST_LABEL_FRAGMENT.test(term);
