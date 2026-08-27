import { resolveRallitLevel } from '../domain/experience';
import { RawJobPosting } from '../domain/job-feed.type';
import { JobSourceListResult } from '../domain/port/job-source.port';

const DETAIL_URL_PREFIX = 'https://www.rallit.com/positions/';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
};

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return null;
};

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const text = asNonEmptyString(item);
    return text === null ? [] : [text];
  });
};

const mapPosting = (raw: unknown): RawJobPosting | null => {
  if (!isRecord(raw)) {
    return null;
  }
  const id = typeof raw.id === 'number' ? raw.id : null;
  const company = asNonEmptyString(raw.companyName);
  const title = asNonEmptyString(raw.title);
  if (id === null || company === null || title === null) {
    return null;
  }
  const rawJobLevel = asNonEmptyString(raw.jobLevel);
  const range = resolveRallitLevel(rawJobLevel ?? '');
  const region = asNonEmptyString(raw.addressRegion);

  return {
    source: 'rallit',
    sourceId: String(id),
    company,
    title,
    detailUrl: asNonEmptyString(raw.url) ?? `${DETAIL_URL_PREFIX}${id}`,
    rawSkillTags: asStringArray(raw.jobSkillKeywords),
    minYears: range.minYears,
    maxYears: range.maxYears,
    yearsSource: 'LEVEL',
    rawJobLevel,
    isNewcomer: rawJobLevel === 'BEGINNER',
    rawLocations: region === null ? [] : [region],
  };
};

export const mapRallitList = (payload: unknown): JobSourceListResult => {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    throw new Error('랠릿 응답 형태가 예상과 다릅니다 (data 없음)');
  }
  const { items, totalPage } = payload.data;
  if (!Array.isArray(items)) {
    throw new Error('랠릿 응답 형태가 예상과 다릅니다 (items 배열 아님)');
  }
  const postings = items.flatMap((raw) => {
    const mapped = mapPosting(raw);
    return mapped === null ? [] : [mapped];
  });
  return {
    received: items.length,
    postings,
    totalPages: typeof totalPage === 'number' && totalPage > 0 ? totalPage : 1,
  };
};
