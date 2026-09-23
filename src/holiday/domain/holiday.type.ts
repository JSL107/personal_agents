import { PlainDate } from '../../schedule/domain/schedule.type';

// 특일 정보 API 가 내려준 공휴일 한 건. 이름은 API 의 `dateName` 을 그대로 쓴다 —
// "설날"·"대체공휴일" 같은 표기를 우리가 고쳐 쓰면 달력에 뜨는 이름과 정부 표기가 갈린다.
export interface KoreanHoliday {
  name: string;
  date: PlainDate;
}
