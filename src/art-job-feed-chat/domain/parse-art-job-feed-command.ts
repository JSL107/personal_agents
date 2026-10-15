import {
  ArtJobKeywordKind,
  normalizeKeywordTerm,
  validateKeywordTerm,
} from '../../art-job-feed/domain/art-job-keyword';

type Action = 'ADD' | 'REMOVE';

export type ArtJobFeedCommand =
  | { kind: 'FETCH' }
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

  if (
    /공고/.test(normalized) &&
    (FETCH_VERB.test(normalized) || /지금\s*공고/.test(normalized)) &&
    !/키워드/.test(normalized)
  ) {
    return { kind: 'FETCH' };
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
  if (action === null) {
    return { kind: 'UNKNOWN' };
  }

  const terms = extractTerms(normalized);
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
    const listKind =
      (current.kind === 'NEEDS_TERMS' ? current.listKind : undefined) ??
      findAnswerListKind(currentText);
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

const findListKind = (text: string): ArtJobKeywordKind | undefined => {
  if (/화풍|태그|그림체|스타일/.test(text)) {
    return 'STYLE';
  }
  if (/제외\s*(?:키워드|목록|어)|거를\s*키워드|걸러줘/.test(text)) {
    return 'EXCLUDED';
  }
  if (/허용|대상|제목\s*키워드/.test(text)) {
    return 'TARGET';
  }
  return undefined;
};

// 목록을 되물은 뒤의 답. 「제외」 단답은 목록 이름이다 — 평소 문장에서는 동사와 헷갈려 받지 않는다.
const findAnswerListKind = (text: string): ArtJobKeywordKind | undefined => {
  return findListKind(text) ?? (/제외/.test(text) ? 'EXCLUDED' : undefined);
};

const extractTerms = (text: string): string[] => {
  const quoted = [
    ...text.matchAll(/\[([^\]]+)\]|「([^」]+)」|"([^"]+)"|'([^']+)'/g),
  ].map((match) => match[1] ?? match[2] ?? match[3] ?? match[4]);
  const raw =
    quoted.length > 0
      ? quoted.flatMap((group) => group.split(/[/,·、]/))
      : extractUnquotedTerms(text);
  return [...new Set(raw.map(cleanTerm).filter(isValidTerm))];
};

const extractUnquotedTerms = (text: string): string[] => {
  const beforeKeyword = text.match(/(?:^|\s)([^\s]+)\s*키워드/);
  if (beforeKeyword) {
    return beforeKeyword[1].split(/[/,·、]/);
  }
  const afterList = text.match(
    /(?:허용|대상|제외어|화풍|태그|그림체|스타일)(?:에|에서|로|으로)?\s+([^\s]+)\s*(?:추가|넣어|등록|포함|제거|삭제|빼|지워|없애)/,
  );
  if (afterList) {
    return afterList[1].split(/[/,·、]/);
  }
  const beforeList = text.match(
    /(?:^|\s)([^\s]+)\s*(?:화풍|태그|그림체|스타일|허용|제외어)/,
  );
  if (beforeList) {
    return beforeList[1].split(/[/,·、]/);
  }
  const beforeVerb = text.match(
    /(?:^|\s)([^\s]+)\s*(?:추가|넣어|등록|포함|제거|삭제|빼|지워|없애|제외\s*해)/,
  );
  return beforeVerb ? beforeVerb[1].split(/[/,·、]/) : [];
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

const isValidTerm = (term: string): boolean =>
  validateKeywordTerm(term) === null;
