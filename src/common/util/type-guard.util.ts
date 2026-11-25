export const isRecord = (value: unknown): value is Record<string, unknown> => {
  const record =
    value !== null && typeof value === 'object' && !Array.isArray(value);
  return record;
};

export const isPositiveSafeInteger = (value: unknown): value is number => {
  const positiveSafeInteger =
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
  return positiveSafeInteger;
};

export const isNonEmptyString = (value: unknown): value is string => {
  const nonEmptyString = typeof value === 'string' && value.trim().length > 0;
  return nonEmptyString;
};
