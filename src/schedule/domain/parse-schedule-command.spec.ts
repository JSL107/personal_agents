import { parseScheduleCommand } from './parse-schedule-command';

const TODAY = { year: 2026, month: 9, day: 18 };

describe('parseScheduleCommand', () => {
  it('날짜와 제목을 모두 뽑는다', () => {
    expect(parseScheduleCommand('9월 30일 자동차세', TODAY)).toEqual({
      kind: 'REGISTER',
      title: '자동차세',
      dueDate: { year: 2026, month: 9, day: 30 },
    });
  });

  it('날짜가 뒤에 와도 제목만 남긴다', () => {
    expect(parseScheduleCommand('건강검진 예약 10월 5일', TODAY)).toEqual({
      kind: 'REGISTER',
      title: '건강검진 예약',
      dueDate: { year: 2026, month: 10, day: 5 },
    });
  });

  it('날짜가 없으면 제목을 들고 되묻기로 간다', () => {
    expect(parseScheduleCommand('자동차세 등록해줘', TODAY)).toEqual({
      kind: 'NEEDS_DATE',
      title: '자동차세',
    });
  });

  it('제목이 비면 되묻는다', () => {
    expect(parseScheduleCommand('9월 30일', TODAY)).toEqual({
      kind: 'NEEDS_TITLE',
    });
  });

  it('조사와 지시 동사를 제목에서 걷어낸다', () => {
    expect(parseScheduleCommand('내일 여권 신청 일정 등록해줘', TODAY)).toEqual(
      {
        kind: 'REGISTER',
        title: '여권 신청',
        dueDate: { year: 2026, month: 9, day: 19 },
      },
    );
  });

  it('제목에 든 "등록"·"추가" 를 지시어로 오인해 지우지 않는다', () => {
    expect(parseScheduleCommand('내일 주민등록 등본 발급', TODAY)).toEqual({
      kind: 'REGISTER',
      title: '주민등록 등본 발급',
      dueDate: { year: 2026, month: 9, day: 19 },
    });
    expect(parseScheduleCommand('내일 자동이체 추가 신청', TODAY)).toEqual({
      kind: 'REGISTER',
      title: '자동이체 추가 신청',
      dueDate: { year: 2026, month: 9, day: 19 },
    });
  });

  it('제목 끝의 낱말을 조사로 오인해 깎지 않는다', () => {
    expect(parseScheduleCommand('내일 계약 유지', TODAY)).toEqual({
      kind: 'REGISTER',
      title: '계약 유지',
      dueDate: { year: 2026, month: 9, day: 19 },
    });
  });

  it('제목 속 분수 표기를 지우지 않는다', () => {
    expect(parseScheduleCommand('내일 지분 1/2 정리', TODAY)).toEqual({
      kind: 'REGISTER',
      title: '지분 1/2 정리',
      dueDate: { year: 2026, month: 9, day: 19 },
    });
  });
});
