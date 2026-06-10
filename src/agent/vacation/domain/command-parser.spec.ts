import { parseVacationCommand } from './command-parser';

describe('parseVacationCommand', () => {
  it('빈 문자열 = BALANCE', () => {
    expect(parseVacationCommand('')).toEqual({ action: 'BALANCE' });
  });
  it('"잔여" = BALANCE', () => {
    expect(parseVacationCommand('잔여')).toEqual({ action: 'BALANCE' });
  });
  it('"내역" = LIST', () => {
    expect(parseVacationCommand('내역')).toEqual({ action: 'LIST' });
  });
  it('"사용 2026-07-01~2026-07-03" = REGISTER + 날짜', () => {
    expect(parseVacationCommand('사용 2026-07-01~2026-07-03')).toEqual({
      action: 'REGISTER',
      startDate: { year: 2026, month: 7, day: 1 },
      endDate: { year: 2026, month: 7, day: 3 },
      memo: undefined,
    });
  });
  it('"사용 2026-07-01~2026-07-03 가족여행" = REGISTER + memo', () => {
    expect(
      parseVacationCommand('사용 2026-07-01~2026-07-03 가족여행'),
    ).toMatchObject({
      action: 'REGISTER',
      memo: '가족여행',
    });
  });
  it('"사용 2026-07-01" (단일일) = REGISTER start=end', () => {
    expect(parseVacationCommand('사용 2026-07-01')).toMatchObject({
      action: 'REGISTER',
      startDate: { year: 2026, month: 7, day: 1 },
      endDate: { year: 2026, month: 7, day: 1 },
    });
  });
  it('"취소 10" = CANCEL id=10', () => {
    expect(parseVacationCommand('취소 10')).toEqual({
      action: 'CANCEL',
      usageId: 10,
    });
  });
  it('날짜 형식 깨지면 INVALID', () => {
    expect(parseVacationCommand('사용 2026/07/01')).toEqual({
      action: 'INVALID',
    });
  });
  it('"사용 2026-07-01 ~ 2026-07-03" (~ 주변 공백) = REGISTER 범위', () => {
    expect(parseVacationCommand('사용 2026-07-01 ~ 2026-07-03')).toEqual({
      action: 'REGISTER',
      startDate: { year: 2026, month: 7, day: 1 },
      endDate: { year: 2026, month: 7, day: 3 },
      memo: undefined,
    });
  });
  it('알 수 없는 서브커맨드 = INVALID', () => {
    expect(parseVacationCommand('헬로')).toEqual({ action: 'INVALID' });
  });
});
