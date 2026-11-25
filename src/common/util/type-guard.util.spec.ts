import {
  isNonEmptyString,
  isPositiveSafeInteger,
  isRecord,
} from './type-guard.util';

describe('type-guard.util', () => {
  it('객체만 record 로 판정하고 null 과 배열은 거절한다', () => {
    expect(isRecord({ value: 1 })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord('value')).toBe(false);
  });

  it('양의 안전한 정수만 허용한다', () => {
    expect(isPositiveSafeInteger(1)).toBe(true);
    expect(isPositiveSafeInteger(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(isPositiveSafeInteger(0)).toBe(false);
    expect(isPositiveSafeInteger(-1)).toBe(false);
    expect(isPositiveSafeInteger(1.5)).toBe(false);
    expect(isPositiveSafeInteger(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(isPositiveSafeInteger('1')).toBe(false);
  });

  it('trim 후 내용이 있는 문자열만 허용한다', () => {
    expect(isNonEmptyString(' value ')).toBe(true);
    expect(isNonEmptyString(' \t ')).toBe(false);
    expect(isNonEmptyString(null)).toBe(false);
  });
});
