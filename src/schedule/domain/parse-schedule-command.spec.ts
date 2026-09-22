import {
  mergeScheduleCommands,
  parseScheduleCommand,
} from './parse-schedule-command';

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

  it('제목이 비면 되묻되, 읽어낸 날짜는 버리지 않는다 — 직전 턴의 제목과 합쳐야 해서다', () => {
    expect(parseScheduleCommand('9월 30일', TODAY)).toEqual({
      kind: 'NEEDS_TITLE',
      dueDate: { year: 2026, month: 9, day: 30 },
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

  it.each([
    ['자동차세 납부 9월 30일까지', '자동차세 납부'],
    ['여권 재발급 신청 내일까지', '여권 재발급 신청'],
    ['국민연금 신고 2026-10-05까지', '국민연금 신고'],
    ['다음 주 화요일까지 건강검진 예약', '건강검진 예약'],
    ['이사 9월 30일 전까지', '이사'],
  ])('날짜에 붙은 조사를 날짜와 함께 걷어낸다: %s', (text, title) => {
    const command = parseScheduleCommand(text, TODAY);
    expect(command.kind).toBe('REGISTER');
    expect(command).toMatchObject({ title });
  });

  it('제목 속 조사는 남긴다 — 날짜 뒤에서만 걷어내기 때문이다', () => {
    expect(
      parseScheduleCommand('납부까지 끝내기 10월 1일', TODAY),
    ).toMatchObject({ title: '납부까지 끝내기' });
  });
});

describe('mergeScheduleCommands', () => {
  it('제목만 있던 직전 턴과 날짜만 온 이번 턴을 합쳐 등록으로 만든다', () => {
    const prior = parseScheduleCommand('자동차세 등록해줘', TODAY);
    const next = parseScheduleCommand('9월 30일', TODAY);

    expect(prior).toEqual({ kind: 'NEEDS_DATE', title: '자동차세' });
    expect(mergeScheduleCommands(prior, next)).toEqual({
      kind: 'REGISTER',
      title: '자동차세',
      dueDate: { year: 2026, month: 9, day: 30 },
    });
  });

  it('날짜만 있던 직전 턴과 제목만 온 이번 턴도 합친다 — 되묻는 순서가 반대여도 끝난다', () => {
    const prior = parseScheduleCommand('9월 30일 일정 등록해줘', TODAY);
    const next = parseScheduleCommand('자동차세 납부', TODAY);

    expect(mergeScheduleCommands(prior, next)).toEqual({
      kind: 'REGISTER',
      title: '자동차세 납부',
      dueDate: { year: 2026, month: 9, day: 30 },
    });
  });

  it('이번 턴이 정정이면 이번 턴을 택한다', () => {
    const prior = parseScheduleCommand('자동차세 9월 30일', TODAY);
    const next = parseScheduleCommand('10월 5일', TODAY);

    expect(mergeScheduleCommands(prior, next)).toEqual({
      kind: 'REGISTER',
      title: '자동차세',
      dueDate: { year: 2026, month: 10, day: 5 },
    });
  });

  it('둘을 합쳐도 제목이 없으면 계속 되묻는다 — 빈손을 등록으로 위장하지 않는다', () => {
    const prior = parseScheduleCommand('9월 30일', TODAY);
    const next = parseScheduleCommand('10월 5일', TODAY);

    expect(mergeScheduleCommands(prior, next)).toEqual({
      kind: 'NEEDS_TITLE',
      dueDate: { year: 2026, month: 10, day: 5 },
    });
  });
});
