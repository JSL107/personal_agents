import { ArxivEntry, ArxivFields } from './humanize-research.type';

// XML 의존성이 없어 필요한 네 필드만 뽑는다. 패턴은 모듈 로드 때 한 번만 만든다 —
// 필드를 읽을 때마다 new RegExp 하면 100편 응답에 400번 컴파일한다.
const fieldPattern = (name: string): RegExp =>
  new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'iu');

const FIELD_PATTERNS: Record<keyof ArxivFields, RegExp> = {
  id: fieldPattern('id'),
  title: fieldPattern('title'),
  summary: fieldPattern('summary'),
  published: fieldPattern('published'),
};

const ENTRY_PATTERN = /<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/giu;
const CDATA_PATTERN = /^<!\[CDATA\[([\s\S]*?)\]\]>$/u;
const ENTITY_PATTERN = /&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/giu;
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export const extractArxivEntries = (xml: string): ArxivEntry[] => {
  const entries = xml.match(ENTRY_PATTERN) ?? [];
  return entries.flatMap(toEntry);
};

const toEntry = (entry: string): ArxivEntry[] => {
  const fields = readFields(entry);
  if (!fields) {
    return [];
  }
  const published = new Date(fields.published);
  if (Number.isNaN(published.getTime())) {
    return [];
  }
  return [{ ...fields, published }];
};

// 비어 있는 필드는 없는 필드와 같게 본다 — 제목·초록이 빈 논문은 제안 근거가 될 수 없다.
const readFields = (entry: string): ArxivFields | null => {
  const fields: ArxivFields = {
    id: readField({ entry, pattern: FIELD_PATTERNS.id }),
    title: readField({ entry, pattern: FIELD_PATTERNS.title }),
    summary: readField({ entry, pattern: FIELD_PATTERNS.summary }),
    published: readField({ entry, pattern: FIELD_PATTERNS.published }),
  };
  const missing = Object.values(fields).some((value) => value.length === 0);
  if (missing) {
    return null;
  }
  return fields;
};

const readField = ({
  entry,
  pattern,
}: {
  entry: string;
  pattern: RegExp;
}): string => {
  const match = pattern.exec(entry);
  if (!match) {
    return '';
  }
  const raw = match[1].replace(CDATA_PATTERN, '$1');
  const decoded = decodeEntities(raw);
  const normalized = decoded.replace(/\s+/gu, ' ').trim();
  return normalized;
};

const decodeEntities = (value: string): string =>
  value.replace(ENTITY_PATTERN, (match, entity: string) => {
    const lowered = entity.toLowerCase();
    if (lowered.startsWith('#x')) {
      return String.fromCodePoint(Number.parseInt(lowered.slice(2), 16));
    }
    if (lowered.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(lowered.slice(1), 10));
    }
    return NAMED_ENTITIES[lowered] ?? match;
  });
