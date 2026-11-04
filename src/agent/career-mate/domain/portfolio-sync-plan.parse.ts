import { CareerMateException } from './career-mate.exception';
import { CareerMateErrorCode } from './career-mate-error-code.enum';
import { PortfolioSyncPlan } from './portfolio-sync-card.type';

const invalidPlan = (field: string): never => {
  throw new CareerMateException({
    code: CareerMateErrorCode.CONFIG_MISSING,
    message: `계획 파일 형식이 올바르지 않습니다: ${field}`,
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  const isObject = typeof value === 'object' && value !== null;
  const isPlainObject = isObject && !Array.isArray(value);
  return isPlainObject;
};

const requireRecord = ({
  value,
  field,
}: {
  value: unknown;
  field: string;
}): Record<string, unknown> => {
  if (!isRecord(value)) {
    return invalidPlan(field);
  }
  return value;
};

const requireString = ({
  value,
  field,
}: {
  value: unknown;
  field: string;
}): void => {
  if (typeof value !== 'string') {
    invalidPlan(field);
  }
};

const requireNumber = ({
  value,
  field,
}: {
  value: unknown;
  field: string;
}): void => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalidPlan(field);
  }
};

const requireBoolean = ({
  value,
  field,
}: {
  value: unknown;
  field: string;
}): void => {
  if (typeof value !== 'boolean') {
    invalidPlan(field);
  }
};

const requireStringArray = ({
  value,
  field,
}: {
  value: unknown;
  field: string;
}): void => {
  if (!Array.isArray(value)) {
    invalidPlan(field);
  }
  const entries = value as unknown[];
  for (const [index, entry] of entries.entries()) {
    requireString({ value: entry, field: `${field}[${index}]` });
  }
};

const requireNullableString = ({
  value,
  field,
}: {
  value: unknown;
  field: string;
}): void => {
  if (value !== null) {
    requireString({ value, field });
  }
};

const requireNullableNumber = ({
  value,
  field,
}: {
  value: unknown;
  field: string;
}): void => {
  if (value !== null) {
    requireNumber({ value, field });
  }
};

const validateCard = ({
  value,
  index,
}: {
  value: unknown;
  index: number;
}): void => {
  const field = `cards[${index}]`;
  const card = requireRecord({ value, field });
  requireString({ value: card.slug, field: `${field}.slug` });
  requireString({ value: card.repo, field: `${field}.repo` });
  requireNumber({ value: card.topicIndex, field: `${field}.topicIndex` });
  requireBoolean({ value: card.anonymized, field: `${field}.anonymized` });
  requireBoolean({ value: card.regenerate, field: `${field}.regenerate` });
  requireBoolean({ value: card.coverPassed, field: `${field}.coverPassed` });
  requireBoolean({
    value: card.coverWasPublic,
    field: `${field}.coverWasPublic`,
  });
  if (card.action !== 'create' && card.action !== 'update') {
    invalidPlan(`${field}.action`);
  }
  requireStringArray({ value: card.memberPrs, field: `${field}.memberPrs` });
  requireString({ value: card.coverHash, field: `${field}.coverHash` });
  requireRecord({ value: card.body, field: `${field}.body` });
  requireNullableNumber({
    value: card.sortOrderSent,
    field: `${field}.sortOrderSent`,
  });
  requireNullableNumber({
    value: card.sortOrderOwned,
    field: `${field}.sortOrderOwned`,
  });
  requireNullableString({
    value: card.siteProjectId,
    field: `${field}.siteProjectId`,
  });
  if (card.siteBaseline !== null) {
    const baseline = requireRecord({
      value: card.siteBaseline,
      field: `${field}.siteBaseline`,
    });
    requireString({ value: baseline.id, field: `${field}.siteBaseline.id` });
    requireNumber({
      value: baseline.sortOrder,
      field: `${field}.siteBaseline.sortOrder`,
    });
    if (!('links' in baseline)) {
      invalidPlan(`${field}.siteBaseline.links`);
    }
  }
};

const validateSkillGroup = ({
  value,
  index,
}: {
  value: unknown;
  index: number;
}): void => {
  const field = `skillGroups[${index}]`;
  const group = requireRecord({ value, field });
  requireString({ value: group.title, field: `${field}.title` });
  requireStringArray({ value: group.skills, field: `${field}.skills` });
  requireNumber({ value: group.order, field: `${field}.order` });
  requireBoolean({ value: group.highlighted, field: `${field}.highlighted` });
};

const validateAdoption = (value: unknown): void => {
  if (value === null) {
    return;
  }
  const adoption = requireRecord({ value, field: 'adoption' });
  if (!Array.isArray(adoption.rows)) {
    invalidPlan('adoption.rows');
  }
  const rows = adoption.rows as unknown[];
  for (const [index, value] of rows.entries()) {
    const field = `adoption.rows[${index}]`;
    const row = requireRecord({ value, field });
    requireString({ value: row.slug, field: `${field}.slug` });
    requireNullableString({
      value: row.siteProjectId,
      field: `${field}.siteProjectId`,
    });
    requireString({ value: row.repo, field: `${field}.repo` });
    requireNumber({ value: row.topicIndex, field: `${field}.topicIndex` });
    requireStringArray({ value: row.memberPrs, field: `${field}.memberPrs` });
    requireNullableString({ value: row.coverOf, field: `${field}.coverOf` });
  }
  if (!Array.isArray(adoption.table)) {
    invalidPlan('adoption.table');
  }
  const table = adoption.table as unknown[];
  for (const [index, value] of table.entries()) {
    const field = `adoption.table[${index}]`;
    const row = requireRecord({ value, field });
    requireString({ value: row.slug, field: `${field}.slug` });
    requireString({
      value: row.siteProjectId,
      field: `${field}.siteProjectId`,
    });
    requireString({ value: row.title, field: `${field}.title` });
  }
  if (adoption.mismatch !== undefined) {
    const mismatch = requireRecord({
      value: adoption.mismatch,
      field: 'adoption.mismatch',
    });
    requireStringArray({
      value: mismatch.onlyInPlan,
      field: 'adoption.mismatch.onlyInPlan',
    });
    requireStringArray({
      value: mismatch.onlyOnSite,
      field: 'adoption.mismatch.onlyOnSite',
    });
  }
};

const REPORT_FIELDS = [
  'skippedTitles',
  'unnamedKeys',
  'planViolations',
  'notInPlan',
  'unknownTechTerms',
  'ambiguousAssignments',
  'coverRetry',
  'sortOrderKeptByHuman',
] as const;

export const parsePortfolioSyncPlan = (raw: unknown): PortfolioSyncPlan => {
  const plan = requireRecord({ value: raw, field: 'plan' });
  if (plan.version !== 1) {
    invalidPlan('version');
  }
  requireString({ value: plan.baseFingerprint, field: 'baseFingerprint' });
  requireString({ value: plan.createdAt, field: 'createdAt' });
  requireNumber({ value: plan.agentRunId, field: 'agentRunId' });
  if (!Array.isArray(plan.cards)) {
    invalidPlan('cards');
  }
  const cards = plan.cards as unknown[];
  for (const [index, card] of cards.entries()) {
    validateCard({ value: card, index });
  }
  if (!Array.isArray(plan.skillGroups)) {
    invalidPlan('skillGroups');
  }
  const skillGroups = plan.skillGroups as unknown[];
  for (const [index, group] of skillGroups.entries()) {
    validateSkillGroup({ value: group, index });
  }
  const report = requireRecord({ value: plan.report, field: 'report' });
  for (const field of REPORT_FIELDS) {
    requireStringArray({ value: report[field], field: `report.${field}` });
  }
  validateAdoption(plan.adoption);
  return plan as unknown as PortfolioSyncPlan;
};
