import { parseHolidayResponse } from './parse-holiday-response';

// 실제 응답 형태를 본뜬 고정 표본. ⚠️ API 키가 없어 실물과 대조하지 못했다 — 키를 발급받으면
// `curl` 한 번으로 이 형태가 맞는지 확인하고, 다르면 여기 표본부터 고쳐야 한다.
const envelope = (items: unknown): unknown => ({
  response: {
    header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
    body: { items, numOfRows: 100, pageNo: 1, totalCount: 1 },
  },
});

describe('parseHolidayResponse', () => {
  it('배열로 온 항목을 그대로 읽는다', () => {
    const parsed = parseHolidayResponse(
      envelope({
        item: [
          {
            dateKind: '01',
            dateName: '추석',
            isHoliday: 'Y',
            locdate: 20260925,
          },
          {
            dateKind: '01',
            dateName: '개천절',
            isHoliday: 'Y',
            locdate: 20261003,
          },
        ],
      }),
    );
    expect(parsed).toEqual([
      { name: '추석', date: { year: 2026, month: 9, day: 25 } },
      { name: '개천절', date: { year: 2026, month: 10, day: 3 } },
    ]);
  });

  // 이 API 계열은 항목이 하나면 배열을 벗겨 객체 하나로 준다(XML→JSON 변환 흔적).
  // 배열만 받으면 공휴일이 한 건인 달이 통째로 비는데, 그 달은 원래 없는 것과 구분되지 않는다.
  it('항목이 1건이라 배열이 아닌 객체로 와도 읽는다', () => {
    const parsed = parseHolidayResponse(
      envelope({
        item: { dateName: '한글날', isHoliday: 'Y', locdate: 20261009 },
      }),
    );
    expect(parsed).toEqual([
      { name: '한글날', date: { year: 2026, month: 10, day: 9 } },
    ]);
  });

  it('공휴일이 없는 달의 빈 문자열 items 를 빈 배열로 읽는다', () => {
    expect(parseHolidayResponse(envelope(''))).toEqual([]);
  });

  it('locdate 가 문자열로 와도 읽는다', () => {
    const parsed = parseHolidayResponse(
      envelope({
        item: { dateName: '신정', isHoliday: 'Y', locdate: '20260101' },
      }),
    );
    expect(parsed).toEqual([
      { name: '신정', date: { year: 2026, month: 1, day: 1 } },
    ]);
  });

  // 쉬는 날이 아닌 것이 달력에 빨갛게 서면 그날 일정을 잡지 않게 된다 — 표시가 틀리는 것보다
  // 사람의 행동을 바꾸는 쪽이 비싸다.
  it('isHoliday 가 Y 가 아닌 항목은 버린다 — 기념일·절기는 쉬는 날이 아니다', () => {
    const parsed = parseHolidayResponse(
      envelope({
        item: [
          { dateName: '제헌절', isHoliday: 'N', locdate: 20260717 },
          { dateName: '광복절', isHoliday: 'Y', locdate: 20260815 },
        ],
      }),
    );
    expect(parsed).toEqual([
      { name: '광복절', date: { year: 2026, month: 8, day: 15 } },
    ]);
  });

  // JS Date 는 2월 30일을 3월 2일로 조용히 넘긴다. 넘어간 날짜는 엉뚱한 날에 빨갛게 서고,
  // 그것이 틀렸다는 단서가 화면 어디에도 남지 않는다.
  it('달력에 없는 날짜는 버린다 — 다음 달로 밀려 저장되지 않게', () => {
    expect(
      parseHolidayResponse(
        envelope({
          item: { dateName: '없는날', isHoliday: 'Y', locdate: 20260230 },
        }),
      ),
    ).toEqual([]);
  });

  it('8자리가 아닌 locdate 와 이름 없는 항목은 버린다', () => {
    expect(
      parseHolidayResponse(
        envelope({
          item: [
            { dateName: '짧은날짜', isHoliday: 'Y', locdate: 202601 },
            { dateName: '   ', isHoliday: 'Y', locdate: 20260101 },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('응답 껍데기가 어긋나면 빈 배열 — 던지지 않는다', () => {
    expect(parseHolidayResponse(null)).toEqual([]);
    expect(parseHolidayResponse({})).toEqual([]);
    expect(parseHolidayResponse({ response: {} })).toEqual([]);
    expect(parseHolidayResponse('<OpenAPI_ServiceResponse>')).toEqual([]);
  });
});
