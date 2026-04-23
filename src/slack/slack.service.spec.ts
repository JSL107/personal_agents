import { DailyPlan } from '../agent/pm/domain/pm-agent.type';
import { formatDailyPlan } from './slack.service';

describe('formatDailyPlan', () => {
  const base: DailyPlan = {
    topPriority: 'PM Agent 구현 마무리',
    morning: ['크롤러 테스트', 'prisma schema 검토'],
    afternoon: ['README 보강', '코드 리뷰 2건'],
    blocker: null,
    estimatedHours: 7,
    reasoning: 'impact 기준으로 PM Agent 를 오전 최우선으로 배치',
  };

  it('blocker 가 null 이면 Blocker 라인을 출력하지 않는다', () => {
    const output = formatDailyPlan(base);

    expect(output).toContain('*오늘의 최우선 과제*');
    expect(output).toContain('• PM Agent 구현 마무리');
    expect(output).toContain('*오전*');
    expect(output).toContain('• 크롤러 테스트');
    expect(output).toContain('*오후*');
    expect(output).toContain('• README 보강');
    expect(output).toContain('*예상 소요*: 7시간');
    expect(output).toContain('*판단 근거*: impact 기준으로');
    expect(output).not.toContain('*Blocker*');
  });

  it('blocker 가 문자열이면 Blocker 라인을 추가한다', () => {
    const output = formatDailyPlan({
      ...base,
      blocker: '디자인팀 시안 대기',
    });

    expect(output).toContain('*Blocker*: 디자인팀 시안 대기');
  });

  it('morning / afternoon 항목 전체가 bullet 으로 출력된다', () => {
    const output = formatDailyPlan(base);
    const bulletLines = output
      .split('\n')
      .filter((line) => line.startsWith('• '));

    expect(bulletLines).toHaveLength(
      1 + base.morning.length + base.afternoon.length,
    );
  });

  it('morning 배열이 비어 있으면 *오전* 헤더만 남고 bullet 이 없다', () => {
    const output = formatDailyPlan({ ...base, morning: [] });

    const morningSection = output
      .split('\n\n')
      .find((block) => block.startsWith('*오전*'));

    expect(morningSection).toBe('*오전*');
  });
});
