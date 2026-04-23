import { DailyPlan } from '../pm-agent.type';
import {
  coerceToDailyPlan,
  formatPreviousDailyPlanSection,
} from './previous-plan-formatter';

describe('formatPreviousDailyPlanSection', () => {
  const base: DailyPlan = {
    topPriority: 'PM Agent 마무리',
    morning: ['agent-run', 'PM usecase'],
    afternoon: ['Slack handler'],
    blocker: '디자인 시안 대기',
    estimatedHours: 6,
    reasoning: 'r',
  };

  it('topPriority / 오전 / 오후 / blocker / 가이드 모두 출력', () => {
    const text = formatPreviousDailyPlanSection({
      plan: base,
      endedAt: new Date('2026-04-22T05:00:00Z'),
    });

    expect(text).toContain('[직전 PM 실행 (2026-04-22T05:00:00.000Z) 의 plan]');
    expect(text).toContain('- 최우선: PM Agent 마무리');
    expect(text).toContain('- 오전:');
    expect(text).toContain('  - agent-run');
    expect(text).toContain('- 오후:');
    expect(text).toContain('  - Slack handler');
    expect(text).toContain('- blocker: 디자인 시안 대기');
    expect(text).toContain('전일 미완료');
  });

  it('blocker 가 null 이면 blocker 라인 생략', () => {
    const text = formatPreviousDailyPlanSection({
      plan: { ...base, blocker: null },
      endedAt: new Date('2026-04-22T05:00:00Z'),
    });
    expect(text).not.toContain('- blocker:');
  });

  it('morning / afternoon 비어 있으면 헤더 자체 생략', () => {
    const text = formatPreviousDailyPlanSection({
      plan: { ...base, morning: [], afternoon: [] },
      endedAt: new Date('2026-04-22T05:00:00Z'),
    });
    expect(text).not.toContain('- 오전:');
    expect(text).not.toContain('- 오후:');
  });
});

describe('coerceToDailyPlan', () => {
  const valid: DailyPlan = {
    topPriority: 't',
    morning: ['a'],
    afternoon: ['b'],
    blocker: null,
    estimatedHours: 5,
    reasoning: 'r',
  };

  it('shape 맞으면 그대로 반환', () => {
    expect(coerceToDailyPlan(valid)).toEqual(valid);
  });

  it('null / undefined / 원시값은 null', () => {
    expect(coerceToDailyPlan(null)).toBeNull();
    expect(coerceToDailyPlan(undefined)).toBeNull();
    expect(coerceToDailyPlan('string')).toBeNull();
    expect(coerceToDailyPlan(123)).toBeNull();
  });

  it('필수 필드 누락 시 null', () => {
    const { topPriority, ...broken } = valid;
    void topPriority;
    expect(coerceToDailyPlan(broken)).toBeNull();
  });

  it('morning 이 string[] 이 아니면 null', () => {
    expect(coerceToDailyPlan({ ...valid, morning: [1, 2] })).toBeNull();
  });

  it('blocker 가 string|null 이 아니면 null', () => {
    expect(coerceToDailyPlan({ ...valid, blocker: 123 })).toBeNull();
  });
});
