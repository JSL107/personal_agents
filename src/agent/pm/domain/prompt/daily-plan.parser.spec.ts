import { PmAgentException } from '../pm-agent.exception';
import { DailyPlan, TaskItem } from '../pm-agent.type';
import { parseDailyPlan } from './daily-plan.parser';

const task = (title: string, overrides: Partial<TaskItem> = {}): TaskItem => ({
  id: overrides.id ?? `user:${title}`,
  title,
  source: overrides.source ?? 'USER_INPUT',
  subtasks: overrides.subtasks ?? [],
  isCriticalPath: overrides.isCriticalPath ?? false,
});

describe('parseDailyPlan', () => {
  const validPlan: DailyPlan = {
    topPriority: task('PM Agent /today 구현', { isCriticalPath: true }),
    varianceAnalysis: {
      rolledOverTasks: [],
      analysisReasoning: '(이월 없음)',
    },
    morning: [task('prisma schema 확인'), task('프롬프트 다듬기')],
    afternoon: [task('코드 리뷰 2건'), task('일일 회고')],
    blocker: null,
    estimatedHours: 6.5,
    reasoning: '가장 impact 큰 PM Agent 를 오전 집중 시간에 배치',
  };

  it('순수 JSON 문자열을 DailyPlan 으로 파싱한다', () => {
    const result = parseDailyPlan(JSON.stringify(validPlan));
    expect(result).toEqual(validPlan);
  });

  it('```json 코드 펜스 감싼 응답도 벗겨낸 뒤 파싱한다', () => {
    const wrapped = ['```json', JSON.stringify(validPlan), '```'].join('\n');
    const result = parseDailyPlan(wrapped);
    expect(result).toEqual(validPlan);
  });

  it('subtasks / isCriticalPath / varianceAnalysis 가 포함된 신버전 스키마를 정상 파싱', () => {
    const withWbs: DailyPlan = {
      ...validPlan,
      topPriority: task('큰 작업', {
        isCriticalPath: true,
        subtasks: [
          { title: '설계', estimatedMinutes: 60 },
          { title: '구현', estimatedMinutes: 120 },
        ],
      }),
      varianceAnalysis: {
        rolledOverTasks: ['어제 못 한 일'],
        analysisReasoning: '중요도 낮아 오후로 밀었음',
      },
    };
    expect(parseDailyPlan(JSON.stringify(withWbs))).toEqual(withWbs);
  });

  it('JSON 으로 파싱 불가하면 INVALID_MODEL_OUTPUT 예외', () => {
    expect(() => parseDailyPlan('this is not json')).toThrow(PmAgentException);
  });

  it('필수 필드 누락 시 INVALID_MODEL_OUTPUT 예외', () => {
    const broken = { ...validPlan } as Partial<DailyPlan>;
    delete broken.topPriority;
    expect(() => parseDailyPlan(JSON.stringify(broken))).toThrow(
      PmAgentException,
    );
  });

  it('blocker 가 string 또는 null 이 아닐 때 예외', () => {
    const broken = { ...validPlan, blocker: 123 };
    expect(() => parseDailyPlan(JSON.stringify(broken))).toThrow(
      PmAgentException,
    );
  });

  it('morning 이 TaskItem 배열이 아닐 때 예외', () => {
    const broken = { ...validPlan, morning: ['string 뿐'] };
    expect(() => parseDailyPlan(JSON.stringify(broken))).toThrow(
      PmAgentException,
    );
  });

  it('varianceAnalysis 누락 시 예외 (신버전 스키마 필수 필드)', () => {
    const broken = { ...validPlan } as Partial<DailyPlan>;
    delete broken.varianceAnalysis;
    expect(() => parseDailyPlan(JSON.stringify(broken))).toThrow(
      PmAgentException,
    );
  });

  it('알 수 없는 source 값은 예외', () => {
    const broken = {
      ...validPlan,
      topPriority: { ...validPlan.topPriority, source: 'UNKNOWN' },
    };
    expect(() => parseDailyPlan(JSON.stringify(broken))).toThrow(
      PmAgentException,
    );
  });

  it('assignableTaskIds 가 포함된 신버전 schema 를 정상 파싱', () => {
    const withAssignable: DailyPlan = {
      ...validPlan,
      assignableTaskIds: ['user:prisma schema 확인', 'user:코드 리뷰 2건'],
    };
    expect(parseDailyPlan(JSON.stringify(withAssignable))).toEqual(
      withAssignable,
    );
  });

  it('assignableTaskIds 가 누락된 구버전 plan 도 graceful 통과', () => {
    const withoutAssignable = JSON.parse(
      JSON.stringify(validPlan),
    ) as Partial<DailyPlan>;
    delete withoutAssignable.assignableTaskIds;
    expect(parseDailyPlan(JSON.stringify(withoutAssignable))).toEqual(
      withoutAssignable,
    );
  });

  it('assignableTaskIds 가 string 배열이 아니면 예외', () => {
    const broken = { ...validPlan, assignableTaskIds: [1, 2, 3] };
    expect(() => parseDailyPlan(JSON.stringify(broken))).toThrow(
      PmAgentException,
    );
  });

  it('assignableTaskIds 가 빈 배열인 정상 케이스 ("후보 없음" 명시) 통과', () => {
    const empty: DailyPlan = { ...validPlan, assignableTaskIds: [] };
    expect(parseDailyPlan(JSON.stringify(empty))).toEqual(empty);
  });

  it('stalledTasks 가 있으면 방어 파싱해 유효 항목만 정규화한다', () => {
    const payload = {
      ...validPlan,
      stalledTasks: [
        {
          id: 'repo/app#1',
          title: '오래된 PR',
          daysStalled: 5.7,
          url: 'https://github.com/repo/app/pull/1',
        },
        {
          id: '',
          title: 'id 없음',
          daysStalled: 5,
        },
        {
          id: 'repo/app#2',
          title: '날짜 오류',
          daysStalled: '5',
        },
      ],
    };

    expect(parseDailyPlan(JSON.stringify(payload)).stalledTasks).toEqual([
      {
        id: 'repo/app#1',
        title: '오래된 PR',
        daysStalled: 5,
        url: 'https://github.com/repo/app/pull/1',
      },
    ]);
  });

  it('stalledTasks 가 배열이 아니면 빈 배열로 정규화한다', () => {
    const payload = {
      ...validPlan,
      stalledTasks: 'not-array',
    };

    expect(parseDailyPlan(JSON.stringify(payload)).stalledTasks).toEqual([]);
  });
});
