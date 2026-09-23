import { PlainDate } from '../../schedule/domain/schedule.type';
import { KoreanHoliday } from './holiday.type';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// `locdate` 는 `20260101` 꼴 8자리다. 숫자와 문자열을 **둘 다** 받는다 — 어느 쪽으로 오는지
// 실제 응답으로 확인하지 못했고(API 키 미발급), 한쪽만 받으면 나머지 경우에 전부 걸러져
// 빈 결과가 된다. 빈 결과는 "그 달에 공휴일이 없다" 와 구분되지 않아 조용히 지나간다.
const parseLocdate = (value: unknown): PlainDate | null => {
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !/^\d{8}$/.test(text)) {
    return null;
  }
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  const day = Number(text.slice(6, 8));
  // JS Date 는 2월 30일을 3월 2일로 조용히 넘긴다. 넣은 값이 그대로 나오는지 대조해
  // 걸러낸다 — 밀린 날짜는 달력에 엉뚱한 빨간 날로 서고, 그게 틀렸다는 단서가 없다.
  // (`parse-due-date.ts` 의 `toPlainDate` 와 같은 처리.)
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
};

// 정상 결과 코드. 이 값이 아니면 200 이어도 조회가 실패한 것이다.
const RESULT_CODE_OK = '00';

// 이 API 계열은 항목이 **1건이면 배열 대신 객체 하나** 를, **0건이면 `items` 를 빈 문자열**
// 로 주는 것으로 알려져 있다(XML 을 JSON 으로 옮긴 흔적). ⚠️ 실제 응답으로 확인하지 못했다 —
// 키를 발급받으면 `curl` 한 번으로 맞춰야 한다. 세 형태를 다 받아 두면 어느 쪽이 와도
// 안 깨진다.
//
// **알 수 없는 형태는 빈 배열이 아니라 예외다.** 빈 배열로 돌려주면 "그 달에 공휴일이
// 없다"(2월·6월 등 실제로 흔하다)와 구분되지 않아, 스키마가 바뀌거나 오류 본문이 와도
// 정상적인 0건으로 확정된다. 그러면 그 해가 통째로 비어도 작업은 성공으로 끝나 재시도도
// 알림도 일어나지 않는다.
const toItemArray = (items: unknown): unknown[] => {
  if (Array.isArray(items)) {
    return items;
  }
  // 공휴일이 없는 달: `items` 가 빈 문자열이거나 빈 객체로 온다.
  if (items === '' || (isRecord(items) && Object.keys(items).length === 0)) {
    return [];
  }
  if (!isRecord(items)) {
    throw new Error(
      `특일 정보 items 형태를 알 수 없습니다 (${typeof items}) — 공휴일 0건과 구분되지 않아 끊습니다.`,
    );
  }
  const inner = items.item;
  if (Array.isArray(inner)) {
    return inner;
  }
  if (isRecord(inner)) {
    return [inner];
  }
  throw new Error(
    '특일 정보 items.item 형태를 알 수 없습니다 — 공휴일 0건과 구분되지 않아 끊습니다.',
  );
};

const toHoliday = (value: unknown): KoreanHoliday | null => {
  if (!isRecord(value)) {
    return null;
  }
  // `getRestDeInfo` 는 공휴일만 준다고 알려져 있지만, 같은 서비스의 다른 오퍼레이션
  // (기념일·24절기)과 응답 형태가 같아 섞여 들어와도 형식으로는 구분되지 않는다.
  // 쉬는 날이 아닌 것이 달력에 빨갛게 서면 그 날 일정을 잡지 않게 되므로 여기서 끊는다.
  if (value.isHoliday !== 'Y') {
    return null;
  }
  const date = parseLocdate(value.locdate);
  if (!date) {
    return null;
  }
  const name = typeof value.dateName === 'string' ? value.dateName.trim() : '';
  if (!name) {
    return null;
  }
  return { name, date };
};

// 응답 전문 → 공휴일 목록. **형식이 어긋나면 던진다.**
//
// 이 파서를 부르는 쪽(`KoreanHolidayApiClient`)이 HTTP 실패를 이미 예외로 끊으므로 여기까지
// 온 것은 200 이다. 그렇다고 200 을 곧 정상으로 볼 수는 없다 — 이 API 는 키·트래픽 문제를
// 본문에 담아 보내는 경우가 있고, 스키마가 바뀔 수도 있다. 그때 빈 배열을 돌려주면 그것이
// "그 달에 공휴일이 없음" 과 같은 값이 되어, 그 해가 통째로 비어도 아무 신호가 남지 않는다
// (`KoreanHolidayClientPort.fetchMonth` 의 계약이 바로 그것을 금한다).
export const parseHolidayResponse = (body: unknown): KoreanHoliday[] => {
  if (!isRecord(body)) {
    throw new Error('특일 정보 응답이 객체가 아닙니다.');
  }
  const response = body.response;
  if (!isRecord(response)) {
    // 키가 틀리면 `response` 대신 `OpenAPI_ServiceResponse` 껍데기가 온다(2026-09-23 실측).
    throw new Error(
      `특일 정보 응답에 response 가 없습니다 — 최상위 키: ${Object.keys(body).join(', ')}`,
    );
  }
  // 결과 코드가 실린 회차에는 그것부터 본다. `00` 이 아니면 200 이어도 조회 실패다.
  const header = response.header;
  if (isRecord(header) && typeof header.resultCode === 'string') {
    if (header.resultCode !== RESULT_CODE_OK) {
      throw new Error(
        `특일 정보 조회가 실패했습니다: resultCode=${header.resultCode} ${String(header.resultMsg ?? '')}`.trim(),
      );
    }
  }
  const responseBody = response.body;
  if (!isRecord(responseBody)) {
    throw new Error('특일 정보 응답에 body 가 없습니다.');
  }
  return toItemArray(responseBody.items)
    .map(toHoliday)
    .filter((holiday): holiday is KoreanHoliday => holiday !== null);
};
