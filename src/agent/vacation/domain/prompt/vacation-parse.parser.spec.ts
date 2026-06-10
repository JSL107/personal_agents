import { VacationException } from '../vacation.exception';
import { parseNlVacationIntent } from './vacation-parse.prompt';

describe('parseNlVacationIntent', () => {
  it('BALANCE 의도 파싱', () => {
    expect(parseNlVacationIntent('{"action":"BALANCE"}')).toEqual({
      action: 'BALANCE',
    });
  });
  it('code fence 제거 후 파싱', () => {
    expect(parseNlVacationIntent('```json\n{"action":"LIST"}\n```')).toEqual({
      action: 'LIST',
    });
  });
  it('REGISTER + 날짜 파싱 및 PlainDate 변환', () => {
    expect(
      parseNlVacationIntent(
        '{"action":"REGISTER","startDate":"2026-07-01","endDate":"2026-07-03","memo":"가족여행"}',
      ),
    ).toEqual({
      action: 'REGISTER',
      startDate: { year: 2026, month: 7, day: 1 },
      endDate: { year: 2026, month: 7, day: 3 },
      memo: '가족여행',
    });
  });
  it('REGISTER 인데 날짜 형식 깨지면 NL_PARSE_FAILED', () => {
    expect(() =>
      parseNlVacationIntent(
        '{"action":"REGISTER","startDate":"내일","endDate":"내일"}',
      ),
    ).toThrow(VacationException);
  });
  it('JSON 아니면 NL_PARSE_FAILED', () => {
    expect(() => parseNlVacationIntent('잘 모르겠어요')).toThrow(
      VacationException,
    );
  });
});
