import { KoreanHoliday } from '../holiday.type';

export interface KoreanHolidayClientPort {
  // API 키가 설정돼 있는가. **호출 전에 이것부터 묻는다** — 키가 없는 것은 오류가 아니라
  // "아직 붙이지 않았다" 이고, 그 회차는 실패가 아니라 건너뜀으로 보고해야 한다.
  isConfigured(): boolean;
  // 해당 연월의 공휴일. 조회 자체가 실패하면 **빈 배열이 아니라 예외** 를 던진다 —
  // 빈 배열은 "그 달에 공휴일이 없다"(2월·6월 등 실제로 흔하다) 와 구분되지 않아,
  // 실패를 빈손으로 돌려주면 그 달이 영영 비어 있어도 아무도 모른다.
  fetchMonth(year: number, month: number): Promise<KoreanHoliday[]>;
}

export const KOREAN_HOLIDAY_CLIENT_PORT = Symbol('KOREAN_HOLIDAY_CLIENT_PORT');
