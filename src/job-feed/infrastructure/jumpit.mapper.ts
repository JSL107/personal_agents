import { RawJobDetail, RawJobPosting } from '../domain/job-feed.type';
import { JobSourceListResult } from '../domain/port/job-source.port';

const PAGE_SIZE = 16;
const DETAIL_URL_PREFIX = 'https://jumpit.saramin.co.kr/position/';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
};

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return null;
};

const asFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
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
  const sourceId = asFiniteNumber(raw.id);
  const company = asNonEmptyString(raw.companyName);
  const title = asNonEmptyString(raw.title);
  if (sourceId === null || company === null || title === null) {
    return null;
  }
  return {
    source: 'jumpit',
    sourceId: String(sourceId),
    company,
    title,
    detailUrl: `${DETAIL_URL_PREFIX}${sourceId}`,
    rawSkillTags: asStringArray(raw.techStacks),
    minYears: asFiniteNumber(raw.minCareer),
    maxYears: asFiniteNumber(raw.maxCareer),
    yearsSource: 'RANGE',
    rawJobLevel: null,
    isNewcomer: raw.newcomer === true,
    rawLocations: asStringArray(raw.locations),
  };
};

export const mapJumpitList = (payload: unknown): JobSourceListResult => {
  if (!isRecord(payload) || !isRecord(payload.result)) {
    throw new Error('점핏 응답 형태가 예상과 다릅니다 (result 없음)');
  }
  const { positions, totalCount } = payload.result;
  if (!Array.isArray(positions)) {
    throw new Error('점핏 응답 형태가 예상과 다릅니다 (positions 배열 아님)');
  }
  const postings = positions.flatMap((raw) => {
    const mapped = mapPosting(raw);
    return mapped === null ? [] : [mapped];
  });
  const total = asFiniteNumber(totalCount) ?? postings.length;
  return {
    received: positions.length,
    postings,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
};

// 상세의 techStacks 는 목록과 달리 `{stack, imagePath}` 객체 배열이다.
const mapDetailSkillTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isRecord(item)) {
      const plain = asNonEmptyString(item);
      return plain === null ? [] : [plain];
    }
    const stack = asNonEmptyString(item.stack);
    return stack === null ? [] : [stack];
  });
};

export const mapJumpitDetail = (payload: unknown): RawJobDetail => {
  if (!isRecord(payload) || !isRecord(payload.result)) {
    throw new Error('점핏 상세 응답 형태가 예상과 다릅니다');
  }
  const { qualifications, preferredRequirements, responsibility, techStacks } =
    payload.result;
  const jdText = [
    asNonEmptyString(responsibility),
    asNonEmptyString(qualifications),
    asNonEmptyString(preferredRequirements),
  ]
    .filter((piece): piece is string => piece !== null)
    .join('\n\n');

  return { jdText, rawSkillTags: mapDetailSkillTags(techStacks) };
};
