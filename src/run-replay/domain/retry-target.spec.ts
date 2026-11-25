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
});
