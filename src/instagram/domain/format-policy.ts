import { createHash } from 'node:crypto';

export const FORMAT_KNOBS = { early_card: [false, true] } as const;
export const DEFAULT_FORMAT_VALUES = { early_card: false } as const;

export type FormatKnob = keyof typeof FORMAT_KNOBS;
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
    date.toISOString().slice(0, 10) !== text
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
  const knobNames = Object.keys(FORMAT_KNOBS);
  if (!hasKeys(value.champion, knobNames)) {
    return 'champion';
  }
  for (const knob of knobNames) {
    const allowed = FORMAT_KNOBS[knob as FormatKnob];
    const found = value.champion[knob];
    if (
      typeof found !== typeof allowed[0] ||
      !allowed.some((candidate) => candidate === found)
    ) {
      return 'champion';
    }
  }
  const experiment = value.experiment;
  if (experiment === null) {
    return '';
  }
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
  if (!Object.prototype.hasOwnProperty.call(FORMAT_KNOBS, experiment.knob)) {
    return 'experiment';
  }
  const knob = experiment.knob as FormatKnob;
  const allowed = FORMAT_KNOBS[knob];
  if (
    typeof experiment.challenger !== typeof allowed[0] ||
    !allowed.some((candidate) => candidate === experiment.challenger) ||
    experiment.challenger === value.champion[knob] ||
    typeof experiment.start !== 'string' ||
    parseIsoDate(experiment.start) === null
  ) {
    return 'experiment';
  }
  return '';
};

export const assignArm = (
  policy: FormatPolicy,
  day: string,
): FormatAssignment => {
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
  const offset = Math.round(
    (dayDate.getTime() - startDate.getTime()) / 86_400_000,
  );
  if (offset < 0) {
    return { arm: 'champion', values, inExperiment: false };
  }
  const block = Math.floor(offset / 2);
  const position = offset % 2;
  const digest = createHash('sha256')
    .update(`${experiment.id}:${block}`)
    .digest();
  const challengerFirst = digest[0] % 2 === 1;
  if ((position === 0) !== challengerFirst) {
    return { arm: 'champion', values, inExperiment: true };
  }
  values[experiment.knob] = experiment.challenger;
  return { arm: 'challenger', values, inExperiment: true };
};

export const serializePolicy = (policy: FormatPolicy): string => {
  const champion = Object.fromEntries(
    Object.keys(FORMAT_KNOBS).map((knob) => [
      knob,
      policy.champion[knob as FormatKnob],
    ]),
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

const hasKeys = (
  value: unknown,
  keys: string[],
): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const found = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    found.length === expected.length &&
    found.every((key, index) => key === expected[index])
  );
};
