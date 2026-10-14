import { ArtJobListing, ArtJobListResult } from '../domain/art-job-feed.type';

type RecordValue = Record<string, unknown>;

const asRecord = (value: unknown): RecordValue | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as RecordValue;
};

const asText = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }
  return String(value).trim() || null;
};

const namedValue = (value: unknown): string | null => {
  const record = asRecord(value);
  return asText(record ? record.name : value);
};

const decodeHtml = (value: string): string => {
  const entities: Record<string, string> = {
    amp: '&',
    gt: '>',
    lt: '<',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };
  return value.replace(
    /&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi,
    (match, entity: string) => {
      if (entity.startsWith('#')) {
        const hexadecimal = entity[1]?.toLowerCase() === 'x';
        const codePoint = Number.parseInt(
          entity.slice(hexadecimal ? 2 : 1),
          hexadecimal ? 16 : 10,
        );
        return Number.isInteger(codePoint) &&
          codePoint > 0 &&
          codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : match;
      }
      return entities[entity.toLowerCase()] ?? match;
    },
  );
};

const deadlineText = (job: RecordValue): string | null => {
  const closeType = asRecord(job['close-type']);
  const closeCode = asText(closeType?.code);
  if (closeCode === '2' || closeCode === '3' || closeCode === '4') {
    return namedValue(closeType) ?? null;
  }
  const timestamp = asText(job['expiration-timestamp']);
  if (!timestamp || !/^\d+$/.test(timestamp)) {
    return null;
  }
  const date = new Date(Number(timestamp) * 1000);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const month = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul',
      month: 'numeric',
    }).format(date),
  );
  const day = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul',
      day: 'numeric',
    }).format(date),
  );
  return `~${month}/${day}`;
};

const mapJob = (value: unknown): ArtJobListing | null => {
  const job = asRecord(value);
  if (!job || String(job.active) === '0') {
    return null;
  }
  const position = asRecord(job.position);
  const company = asRecord(job.company);
  const companyDetail = asRecord(company?.detail);
  const sourceId = asText(job.id);
  const detailUrl = asText(job.url);
  const title = asText(position?.title);
  const companyName = namedValue(companyDetail) ?? namedValue(company);
  if (!sourceId || !detailUrl || !title || !companyName) {
    return null;
  }
  const rawLocation = namedValue(position?.location);
  const location = rawLocation
    ? decodeHtml(rawLocation.split(',')[0])
        .replace(/\s*>\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : null;
  return {
    source: 'saramin',
    sourceId,
    detailUrl,
    title,
    company: companyName,
    location,
    employmentType: namedValue(position?.['job-type']),
    career: namedValue(position?.['experience-level']),
    deadlineText: deadlineText(job),
  };
};

export const mapSaraminList = (payload: unknown): ArtJobListResult => {
  const jobs = asRecord(asRecord(payload)?.jobs);
  const rows = jobs?.job;
  if (!Array.isArray(rows)) {
    return { received: 0, listings: [] };
  }
  const listings = rows
    .map(mapJob)
    .filter((listing): listing is ArtJobListing => listing !== null);
  return { received: rows.length, listings };
};
