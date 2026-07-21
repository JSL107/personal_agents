import { detectQualityAnomalies } from './ops-quality.anomaly';

const empty = { agents: [], previews: [] };

describe('detectQualityAnomalies', () => {
  it('임계 이하면 이상 없음', () => {
    expect(
      detectQualityAnomalies({
        agents: [
          {
            agentType: 'PM',
            total: 10,
            failed: 1,
            failRate: 0.1,
            retries: 0,
            retryRate: 0,
            sweptCount: 0,
          },
        ],
        previews: [],
      }),
    ).toEqual([]);
  });

  it('실패율 초과 + 최소표본 충족 시 FAIL_RATE', () => {
    const result = detectQualityAnomalies({
      agents: [
        {
          agentType: 'PM',
          total: 10,
          failed: 3,
          failRate: 0.3,
          retries: 0,
          retryRate: 0,
          sweptCount: 0,
        },
      ],
      previews: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      scope: 'agent',
      key: 'PM',
      kind: 'FAIL_RATE',
    });
  });

  it('최소표본 미달이면 실패율 높아도 무시', () => {
    expect(
      detectQualityAnomalies({
        agents: [
          {
            agentType: 'PM',
            total: 2,
            failed: 2,
            failRate: 1,
            retries: 0,
            retryRate: 0,
            sweptCount: 0,
          },
        ],
        previews: [],
      }),
    ).toEqual([]);
  });

  it('좀비 1건 이상이면 ZOMBIE', () => {
    const result = detectQualityAnomalies({
      agents: [
        {
          agentType: 'BE',
          total: 10,
          failed: 0,
          failRate: 0,
          retries: 0,
          retryRate: 0,
          sweptCount: 2,
        },
      ],
      previews: [],
    });

    expect(result[0]).toMatchObject({ kind: 'ZOMBIE', key: 'BE' });
  });

  it('preview reject율 초과 시 PREVIEW_REJECT', () => {
    const result = detectQualityAnomalies({
      agents: [],
      previews: [
        {
          kind: 'EVENING_BLOG_PUBLISH',
          applied: 1,
          cancelled: 2,
          expired: 1,
          total: 4,
          rejectRate: 0.75,
        },
      ],
    });

    expect(result[0]).toMatchObject({
      scope: 'preview',
      key: 'EVENING_BLOG_PUBLISH',
      kind: 'PREVIEW_REJECT',
    });
  });

  it('빈 프로필이면 이상 없음', () => {
    expect(detectQualityAnomalies(empty)).toEqual([]);
  });
});
