// 일정 조회 문장 판별 — 등록 파서보다 먼저 본다.
//
// 등록 파서(parseScheduleCommand)는 문장 전체를 제목으로 읽는다. 그래서 "이번주 일정 알려줘" 는 제목
// "이번주 일정 알려줘" 로 날짜를 되묻고(다음 턴 날짜와 합쳐지면 그대로 등록된다), "오늘 할 일" 은
// 제목 "할 일" 로 바로 등록된다(2026-10-08 실측). 조회 문장이면 등록 경로에 넣지 않는다.

const LOOKUP_NOUN = '(?:일정|할\\s*일|마감|스케줄|예약)';
const LOOKUP_VERB = '(?:뭐|무엇|알려|보여|있어|있나|있지|확인|목록|정리|남았)';
const PERIOD = '(?:오늘|내일|모레|이번\\s*주|다음\\s*주|이번\\s*달|다음\\s*달)';

const LOOKUP_PATTERNS: readonly RegExp[] = [
  // "이번주 일정 뭐 있어", "다음주 마감 알려줘", "예약 목록 보여줘"
  new RegExp(`${LOOKUP_NOUN}.{0,10}${LOOKUP_VERB}`),
  // 기간 + 명사만 있는 짧은 조회: "오늘 할 일", "이번주 일정?"
  new RegExp(`^\\s*${PERIOD}\\s*${LOOKUP_NOUN}\\s*[?？]?\\s*$`),
];

// 명시적 쓰기 지시가 있으면 조회가 아니다 — "내일 예약 확인 일정 등록해줘" 처럼 제목에 조회 낱말이
// 섞인 등록 요청이 조회로 빠지지 않게(#753 리뷰).
const WRITE_INTENT =
  /(?:등록|추가|넣어|잡아)\s*(?:해|줘|줄래|주세요|해줘|할래|하자|요)?/;

export const isScheduleLookup = (text: string): boolean =>
  !WRITE_INTENT.test(text) &&
  LOOKUP_PATTERNS.some((pattern) => pattern.test(text));
