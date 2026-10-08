import { isScheduleLookup } from './schedule-lookup';

describe('isScheduleLookup', () => {
  it.each([
    '이번주 일정 알려줘',
    '이번주 일정 뭐 있어',
    '다음주 마감 보여줘',
    '10월 일정 확인해줘',
    '오늘 할 일',
    '이번주 일정?',
    '예약 목록 보여줘',
    '이번 달 마감 남았어?',
  ])('"%s" 는 조회다', (text) => {
    expect(isScheduleLookup(text)).toBe(true);
  });

  it.each([
    '9월 30일 자동차세',
    '내일 여권 신청 일정 등록해줘',
    '10월 5일 건강검진 예약',
    '자동차세 마감 등록해줘',
    '11월 1일 재산세 납부',
    '다음주 월요일 치과',
    '9월 30일',
    // 제목에 조회 낱말이 섞여도 명시적 등록 지시면 등록이다(#753 리뷰).
    '내일 예약 확인 일정 등록해줘',
    '다음주 마감 정리 일정 추가해줘',
  ])('"%s" 는 등록(대조군)이다', (text) => {
    expect(isScheduleLookup(text)).toBe(false);
  });
});
