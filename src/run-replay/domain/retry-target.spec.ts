import { classifyRetryTarget } from './retry-target';

describe('classifyRetryTarget', () => {
  const run = {
    status: 'SUCCEEDED',
    agentType: 'SCHEDULE',
    inputSnapshot: {
      parsedIntent: {
        kind: 'REGISTER',
        title: '일정',
        dueDate: { year: 2026, month: 11, day: 25 },
        heldWrite: { action: 'REGISTER' },
      },
    },
  };
  it('실패 실행을 재실행 대상으로 판정한다', () => {
    expect(classifyRetryTarget({ ...run, status: 'FAILED' }).kind).toBe(
      'FAILED',
    );
  });
  it('유효한 보류 일정은 등록 확인 대상으로 판정한다', () => {
    expect(classifyRetryTarget(run).kind).toBe('HELD_SCHEDULE');
  });
  it('날짜가 유효하지 않거나 정보가 부족한 보류는 재실행을 거절한다', () => {
    const parsedIntent = {
      ...run.inputSnapshot.parsedIntent,
      dueDate: { year: 2026, month: 2, day: 30 },
    };
    expect(
      classifyRetryTarget({ ...run, inputSnapshot: { parsedIntent } }).kind,
    ).toBe('HELD_UNAVAILABLE');
  });
  it('일반 성공 실행을 거절한다', () => {
    expect(classifyRetryTarget({ ...run, inputSnapshot: {} }).kind).toBe(
      'OTHER',
    );
  });

  it.each([
    [
      'REGISTER',
      {
        action: 'REGISTER',
        startDate: { year: 2026, month: 12, day: 1 },
        endDate: { year: 2026, month: 12, day: 2 },
        memo: '여행',
        fraction: 0.5,
      },
      'HELD_VACATION_REGISTER',
    ],
    ['CANCEL', { action: 'CANCEL', usageId: 12 }, 'HELD_VACATION_CANCEL'],
  ])(
    '휴가 %s 보류 의도가 유효하면 확인 카드 대상으로 판정한다',
    (action, heldIntent, kind) => {
      const target = classifyRetryTarget({
        status: 'SUCCEEDED',
        agentType: 'VACATION',
        inputSnapshot: {
          asOf: '2026-11-25',
          parsedIntent: { heldWrite: { action, intent: heldIntent } },
        },
      });
      expect(target.kind).toBe(kind);
    },
  );

  it.each([
    [
      'ADD',
      {
        action: 'ADD',
        company: '토스',
        role: '백엔드',
        status: 'APPLIED',
        deadline: { year: 2026, month: 12, day: 1 },
      },
      'HELD_JOB_ADD',
    ],
    [
      'UPDATE_STATUS',
      { action: 'UPDATE_STATUS', ref: '토스', status: 'SCREENING' },
      'HELD_JOB_UPDATE_STATUS',
    ],
  ])(
    '지원 %s 보류 의도가 유효하면 확인 카드 대상으로 판정한다',
    (action, heldIntent, kind) => {
      const target = classifyRetryTarget({
        status: 'SUCCEEDED',
        agentType: 'JOB_APPLICATION',
        inputSnapshot: {
          today: '2026-11-25',
          parsedIntent: { heldWrite: { action, intent: heldIntent } },
        },
      });
      expect(target.kind).toBe(kind);
    },
  );

  it.each([
    [
      'VACATION',
      'REGISTER',
      {
        action: 'REGISTER',
        startDate: { year: 2026, month: 12, day: 3 },
        endDate: { year: 2026, month: 12, day: 2 },
      },
    ],
    ['VACATION', 'CANCEL', { action: 'CANCEL', usageId: 0 }],
    ['JOB_APPLICATION', 'ADD', { action: 'ADD', company: '', role: '백엔드' }],
    [
      'JOB_APPLICATION',
      'UPDATE_STATUS',
      { action: 'UPDATE_STATUS', ref: '토스', status: 'UNKNOWN' },
    ],
    [
      'JOB_APPLICATION',
      'ADD',
      {
        action: 'ADD',
        company: '토스',
        role: '백엔드',
        jdUrl: 'javascript:alert(1)',
      },
    ],
  ])(
    '%s %s 보류 의도가 잘못됐으면 재실행을 거절한다',
    (agentType, action, heldIntent) => {
      const target = classifyRetryTarget({
        status: 'SUCCEEDED',
        agentType,
        inputSnapshot: {
          asOf: '2026-11-25',
          today: '2026-11-25',
          parsedIntent: { heldWrite: { action, intent: heldIntent } },
        },
      });
      expect(target.kind).toBe('HELD_UNAVAILABLE');
    },
  );
});
