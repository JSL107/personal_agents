import { AUTOPILOT_PLAYBOOK, validatePlaybook } from './autopilot.playbook';
import { PlaybookEntry } from './playbook.type';

describe('AUTOPILOT_PLAYBOOK', () => {
  it('SP1 플레이북은 daily-eval CRON 항목을 포함한다', () => {
    const dailyEval = AUTOPILOT_PLAYBOOK.find((e) => e.id === 'daily-eval');
    expect(dailyEval).toBeDefined();
    expect(dailyEval?.trigger.kind).toBe('CRON');
    expect(dailyEval?.taskId).toBe('daily-eval');
    expect(dailyEval?.riskTier).toBe('T0_AUTO');
  });

  it('validatePlaybook 은 정상 플레이북을 통과시킨다', () => {
    expect(() => validatePlaybook(AUTOPILOT_PLAYBOOK)).not.toThrow();
  });

  it('validatePlaybook 은 중복 id 를 거부한다', () => {
    const dup: PlaybookEntry[] = [
      {
        id: 'x',
        taskId: 'x',
        trigger: {
          kind: 'CRON',
          schedule: '0 9 * * *',
          timezone: 'Asia/Seoul',
        },
        riskTier: 'T0_AUTO',
      },
      {
        id: 'x',
        taskId: 'x',
        trigger: {
          kind: 'CRON',
          schedule: '0 9 * * *',
          timezone: 'Asia/Seoul',
        },
        riskTier: 'T0_AUTO',
      },
    ];
    expect(() => validatePlaybook(dup)).toThrow(/중복/);
  });
});
