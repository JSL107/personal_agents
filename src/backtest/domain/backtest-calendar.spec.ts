import { buildBacktestCalendar } from './backtest-calendar';

describe('buildBacktestCalendar', () => {
  it('추천일은 주말을 뺀 모든 평일이고 체결일은 봉이 있는 날뿐이다', () => {
    // 2026-08-15(토) 2026-08-16(일) 은 주말.
    // 2026-08-13(목) 2026-08-14(금) 2026-08-17(월) 에 봉이 있고
    // 2026-08-18(화) 에는 없다고 가정한다 (휴장).
    const tradeDates = ['2026-08-13', '2026-08-14', '2026-08-17'];

    const calendar = buildBacktestCalendar({
      from: '2026-08-13',
      to: '2026-08-18',
      tradeDates,
    });

    expect(calendar.recommendDates).toEqual([
      '2026-08-13',
      '2026-08-14',
      '2026-08-17',
      '2026-08-18',
    ]);
    expect(calendar.tradeDates).toEqual([
      '2026-08-13',
      '2026-08-14',
      '2026-08-17',
    ]);
  });

  it('구간 밖 거래일은 제외한다', () => {
    const calendar = buildBacktestCalendar({
      from: '2026-08-14',
      to: '2026-08-14',
      tradeDates: ['2026-08-13', '2026-08-14', '2026-08-17'],
    });

    expect(calendar.tradeDates).toEqual(['2026-08-14']);
  });

  it('from 이 to 보다 뒤면 에러를 던진다', () => {
    expect(() =>
      buildBacktestCalendar({
        from: '2026-08-18',
        to: '2026-08-13',
        tradeDates: [],
      }),
    ).toThrow(
      'from 이 to 보다 뒤일 수 없습니다. from: 2026-08-18, to: 2026-08-13',
    );
  });

  it('날짜가 YYYY-MM-DD 형식이 아니면 에러를 던진다', () => {
    expect(() =>
      buildBacktestCalendar({
        from: '2026-8-13',
        to: '2026-08-18',
        tradeDates: [],
      }),
    ).toThrow('from는 YYYY-MM-DD 형식이어야 합니다. 받은 값: 2026-8-13');

    expect(() =>
      buildBacktestCalendar({
        from: '2026-08-13',
        to: '20260818',
        tradeDates: [],
      }),
    ).toThrow('to는 YYYY-MM-DD 형식이어야 합니다. 받은 값: 20260818');
  });

  it('거래일에 중복이 있어도 결과에는 중복이 없다', () => {
    const calendar = buildBacktestCalendar({
      from: '2026-08-13',
      to: '2026-08-18',
      tradeDates: [
        '2026-08-13',
        '2026-08-13',
        '2026-08-14',
        '2026-08-14',
        '2026-08-14',
      ],
    });

    expect(calendar.tradeDates).toEqual(['2026-08-13', '2026-08-14']);
  });

  it('거래일이 정렬돼 있지 않아도 결과는 오름차순이다', () => {
    const calendar = buildBacktestCalendar({
      from: '2026-08-13',
      to: '2026-08-18',
      tradeDates: ['2026-08-17', '2026-08-13', '2026-08-14'],
    });

    expect(calendar.tradeDates).toEqual([
      '2026-08-13',
      '2026-08-14',
      '2026-08-17',
    ]);
  });
});
