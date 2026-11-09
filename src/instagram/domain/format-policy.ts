import { createHash } from 'node:crypto';

export const FORMAT_KNOBS = { early_card: [false, true] } as const;
export const DEFAULT_FORMAT_VALUES = { early_card: false } as const;
const ISO_DATE_LENGTH = 10;
const DAY_MS = 86_400_000;
const DAYS_PER_BLOCK = 2;
const PARITY_MODULUS = 2;

export type FormatKnob = keyof typeof FORMAT_KNOBS;
export const FORMAT_KNOB_NAMES: readonly FormatKnob[] = ['early_card'];
export const isFormatKnob = (value: string): value is FormatKnob =>
  FORMAT_KNOB_NAMES.some((knob) => knob === value);
export type FormatKnobValue = boolean | string | number;
export type FormatValues = Record<FormatKnob, FormatKnobValue>;
export type FormatExperiment = {
  id: string;
  knob: FormatKnob;
  challenger: FormatKnobValue;
  start: string;
};
export type FormatPolicy = {
  version: number;
  frozen: boolean;
  champion: FormatValues;
  experiment: FormatExperiment | null;
};
export type FormatAssignment = {
  arm: 'champion' | 'challenger';
  values: FormatValues;
  inExperiment: boolean;
};

export const parseIsoDate = (text: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || text.startsWith('0000-')) {
    return null;
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, ISO_DATE_LENGTH) !== text
  ) {
    return null;
  }
  return date;
};

export const policyProblem = (value: unknown): string => {
  if (!hasKeys(value, ['version', 'frozen', 'champion', 'experiment'])) {
    return 'keys';
  }
  if (
    !Number.isInteger(value.version) ||
    typeof value.version !== 'number' ||
    typeof value.frozen !== 'boolean'
  ) {
    return 'types';
  }
  const championError = championProblem(value.champion);
  if (championError) {
    return championError;
  }
  const experiment = value.experiment;
  if (experiment === null) {
    return '';
  }
  return experimentProblem({ experiment, champion: value.champion });
};

export const isFormatPolicy = (value: unknown): value is FormatPolicy =>
  policyProblem(value) === '';

const championProblem = (champion: unknown): string => {
  if (!hasKeys(champion, FORMAT_KNOB_NAMES)) {
    return 'champion';
  }
  for (const knob of FORMAT_KNOB_NAMES) {
    const allowed = FORMAT_KNOBS[knob];
    const found = champion[knob];
    if (
      typeof found !== typeof allowed[0] ||
      !allowed.some((candidate) => candidate === found)
    ) {
      return 'champion';
    }
  }
  return '';
};

const experimentProblem = ({
  experiment,
  champion,
}: {
  experiment: unknown;
  champion: unknown;
}): string => {
  if (!hasKeys(experiment, ['id', 'knob', 'challenger', 'start'])) {
    return 'experiment';
  }
  if (
    typeof experiment.id !== 'string' ||
    experiment.id.length === 0 ||
    typeof experiment.knob !== 'string'
  ) {
    return 'experiment';
  }
  if (!isFormatKnob(experiment.knob)) {
    return 'experiment';
  }
  const knob = experiment.knob;
  const allowed = FORMAT_KNOBS[knob];
  if (
    typeof experiment.challenger !== typeof allowed[0] ||
    !allowed.some((candidate) => candidate === experiment.challenger) ||
    (hasKeys(champion, FORMAT_KNOB_NAMES) &&
      experiment.challenger === champion[knob]) ||
    typeof experiment.start !== 'string' ||
    parseIsoDate(experiment.start) === null
  ) {
    return 'experiment';
  }
  return '';
};

export const assignArm = ({
  policy,
  day,
}: {
  policy: FormatPolicy;
  day: string;
}): FormatAssignment => {
  const values = { ...policy.champion };
  const experiment = policy.experiment;
  if (policy.frozen || experiment === null) {
    return { arm: 'champion', values, inExperiment: false };
  }
  const dayDate = parseIsoDate(day);
  const startDate = parseIsoDate(experiment.start);
  if (dayDate === null || startDate === null) {
    throw new Error('실험 배정 날짜가 올바르지 않습니다');
  }
  const offset = Math.round((dayDate.getTime() - startDate.getTime()) / DAY_MS);
  if (offset < 0) {
    return { arm: 'champion', values, inExperiment: false };
  }
  const block = Math.floor(offset / DAYS_PER_BLOCK);
  const position = offset % DAYS_PER_BLOCK;
  const digest = createHash('sha256')
    .update(`${experiment.id}:${block}`)
    .digest();
  const challengerFirst = digest[0] % PARITY_MODULUS === 1;
  if ((position === 0) !== challengerFirst) {
    return { arm: 'champion', values, inExperiment: true };
  }
  values[experiment.knob] = experiment.challenger;
  return { arm: 'challenger', values, inExperiment: true };
};

export const serializePolicy = (policy: FormatPolicy): string => {
  const champion = Object.fromEntries(
    FORMAT_KNOB_NAMES.map((knob) => [knob, policy.champion[knob]]),
  );
  const experiment =
    policy.experiment === null
      ? null
      : {
          id: policy.experiment.id,
          knob: policy.experiment.knob,
          challenger: policy.experiment.challenger,
          start: policy.experiment.start,
        };
  const serialized = JSON.stringify({
    version: policy.version,
    frozen: policy.frozen,
    champion,
    experiment,
  });
  return `${serialized}\n`;
};

// 타입 가드는 이름 있는 매개변수만 좁힐 수 있어 구조 분해 대신 위치 인자를 쓴다(CODE_RULES §3-11 예외).
const hasKeys = (
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const found = Object.keys(value).sort();
  const expected = [...keys].sort();
  const sameKeys =
    found.length === expected.length &&
    found.every((key, index) => key === expected[index]);
  return sameKeys;
};
