import { holidayCalendarOf } from '../../holiday/domain/business-calendar';
import { settlementDateOf, targetTradeDateOf } from './trade-calendar';

const NO_HOLIDAYS = holidayCalendarOf([]);
const CHUSEOK_2026 = holidayCalendarOf([
  '2026-09-24',
  '2026-09-25',
  '2026-09-26',
]);

describe('targetTradeDateOf', () => {
  it.each([
    ['금요일', '2026-08-14', '2026-08-17'],
    ['토요일', '2026-08-15', '2026-08-17'],
    ['일요일', '2026-08-16', '2026-08-17'],
  ])('%s에는 다음 월요일을 반환한다', (_label, currentDate, expected) => {
    expect(
      targetTradeDateOf(new Date(`${currentDate}T12:00:00.000Z`), NO_HOLIDAYS),
    ).toEqual(new Date(`${expected}T00:00:00.000Z`));
  });

  it('평일에는 바로 다음 날을 반환한다', () => {
    expect(
      targetTradeDateOf(new Date('2026-08-18T12:00:00.000Z'), NO_HOLIDAYS),
    ).toEqual(new Date('2026-08-19T00:00:00.000Z'));
  });

  // 주문 127·128·129 가 휴장일(09-24·25)을 목표일로 받은 회차의 재현.
  it('추석 전날 저녁 추천은 연휴 뒤 첫 거래일(09-28)을 목표로 한다', () => {
    expect(
      targetTradeDateOf(new Date('2026-09-23T10:30:00.000Z'), CHUSEOK_2026),
    ).toEqual(new Date('2026-09-28T00:00:00.000Z'));
  });
});

describe('settlementDateOf', () => {
  it('체결일에서 주말을 건너뛴 이틀 뒤 결제일을 계산한다', () => {
    expect(
      settlementDateOf(new Date('2026-08-14T12:00:00.000Z'), NO_HOLIDAYS),
    ).toEqual(new Date('2026-08-18T00:00:00.000Z'));
  });

  // 거래 122(09-23 매수)의 결제일이 09-25 로 적힌 회차의 재현.
  it('추석 전날 체결분의 결제일은 연휴를 건너뛴 09-29 이다', () => {
    expect(
      settlementDateOf(new Date('2026-09-23T00:00:00.000Z'), CHUSEOK_2026),
    ).toEqual(new Date('2026-09-29T00:00:00.000Z'));
  });
});
