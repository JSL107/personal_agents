import { normalizeWantedMaxYears } from '../domain/experience';
import { RawJobDetail, RawJobPosting } from '../domain/job-feed.type';
import { JobSourceListResult } from '../domain/port/job-source.port';

const DETAIL_URL_PREFIX = 'https://www.wanted.co.kr/wd/';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
};

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return null;
};

const asNumber = (value: unknown): number | null => {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const mapPosting = (raw: unknown): RawJobPosting | null => {
  if (!isRecord(raw)) {
    return null;
  }
  const id = asNumber(raw.id);
  const title = asNonEmptyString(raw.position);
  const company = isRecord(raw.company)
    ? asNonEmptyString(raw.company.name)
    : null;
  if (id === null || title === null || company === null) {
    return null;
  }
  const location = isRecord(raw.address)
    ? asNonEmptyString(raw.address.location)
    : null;

  return {
    source: 'wanted',
    sourceId: String(id),
    company,
    title,
    detailUrl: `${DETAIL_URL_PREFIX}${id}`,
    // 목록에는 skill_tags 가 없다. 상세를 가져올 때 채운다.
    rawSkillTags: [],
    minYears: asNumber(raw.annual_from),
    maxYears: normalizeWantedMaxYears(asNumber(raw.annual_to)),
    yearsSource: 'RANGE',
    rawJobLevel: null,
    isNewcomer: false,
    rawLocations: location === null ? [] : [location],
  };
};

export const mapWantedList = (payload: unknown): JobSourceListResult => {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error('원티드 응답 형태가 예상과 다릅니다 (data 배열 아님)');
  }
  const postings = payload.data.flatMap((raw) => {
    const mapped = mapPosting(raw);
    return mapped === null ? [] : [mapped];
  });
  return {
    received: payload.data.length,
    postings,
    // 목록 응답에 전체 건수가 없다. 페이지는 호출부가 offset 으로 넘긴다.
    totalPages: postings.length === 0 ? 1 : Number.MAX_SAFE_INTEGER,
  };
};

export const mapWantedDetail = (payload: unknown): RawJobDetail => {
  if (!isRecord(payload) || !isRecord(payload.job)) {
    throw new Error('원티드 상세 응답 형태가 예상과 다릅니다');
  }
  const { skill_tags: skillTags, detail } = payload.job;
  const jdText = isRecord(detail)
    ? [
        asNonEmptyString(detail.main_tasks),
        asNonEmptyString(detail.requirements),
        asNonEmptyString(detail.preferred_points),
      ]
        .filter((piece): piece is string => piece !== null)
        .join('\n\n')
    : '';

  const rawSkillTags = Array.isArray(skillTags)
    ? skillTags.flatMap((tag) => {
        if (!isRecord(tag)) {
          return [];
        }
        const title = asNonEmptyString(tag.title);
        return title === null ? [] : [title];
      })
    : [];

  return { jdText, rawSkillTags };
};
