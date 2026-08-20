import { PoShadowFinding, PoShadowReport } from '../po-shadow.type';

const MAX_FINDING_COUNT = 3;
const MAX_HEADLINE_LENGTH = 80;
const MAX_FINDING_TEXT_LENGTH = 60;
const REPORT_KEYS = new Set([
  'schemaVersion',
  'quiet',
  'headline',
  'findings',
  'purposeConflict',
  'factSummary',
  'droppedFindingCount',
  'degradedSources',
]);
const FINDING_KEYS = new Set(['factIds', 'point', 'suggestion']);

export const isPoShadowReportShape = (
  value: unknown,
): value is PoShadowReport => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const purposeConflict = record.purposeConflict;
  return (
    hasOnlyAllowedKeys(record, REPORT_KEYS) &&
    record.schemaVersion === 2 &&
    record.quiet === false &&
    isNonBlankBoundedString(record.headline, MAX_HEADLINE_LENGTH) &&
    isFindingArray(record.findings) &&
    (purposeConflict === null || isNonBlankString(purposeConflict)) &&
    isEmptyArray(record.factSummary) &&
    record.droppedFindingCount === 0 &&
    // factSummary·droppedFindingCount 와 같은 자리 — 사실은 코드가 채운다. 모델에게는
    // 빈 값을 요구해 두고, 채우는 주체가 코드임을 스키마로 못박는다.
    isEmptyArray(record.degradedSources)
  );
};

const isFindingArray = (value: unknown): value is PoShadowFinding[] => {
  return (
    Array.isArray(value) &&
    value.length <= MAX_FINDING_COUNT &&
    value.every(isFindingShape)
  );
};

const isFindingShape = (value: unknown): value is PoShadowFinding => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    hasOnlyAllowedKeys(record, FINDING_KEYS) &&
    isNonEmptyStringArray(record.factIds) &&
    isNonBlankBoundedString(record.point, MAX_FINDING_TEXT_LENGTH) &&
    isNonBlankBoundedString(record.suggestion, MAX_FINDING_TEXT_LENGTH)
  );
};

const isNonBlankBoundedString = (
  value: unknown,
  maxLength: number,
): boolean => {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
};

const isNonBlankString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isEmptyArray = (value: unknown): value is [] =>
  Array.isArray(value) && value.length === 0;

const isStringArray = (value: unknown): value is string[] => {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
};

const isNonEmptyStringArray = (value: unknown): value is string[] => {
  return isStringArray(value) && value.length > 0;
};

const hasOnlyAllowedKeys = (
  record: Record<string, unknown>,
  allowedKeys: Set<string>,
): boolean => {
  return Object.keys(record).every((key) => allowedKeys.has(key));
};
