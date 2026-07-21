import { buildQualityProfiles } from './ops-quality.aggregator';

describe('buildQualityProfiles', () => {
  it('실패율은 swept 좀비를 제외해 보정한다', () => {
    const result = buildQualityProfiles({
      base: [
        {
          agentType: 'PM',
          total: 10,
          failed: 4,
          failRate: 0.4,
          avgDurationMs: 1000,
        },
      ],
      retries: [{ agentType: 'PM', retries: 2 }],
      swept: [{ agentType: 'PM', swept: 3 }],
      previews: [],
    });

    const pm = result.agents[0];
    expect(pm.failed).toBe(1);
    expect(pm.failRate).toBeCloseTo(0.1);
    expect(pm.retries).toBe(2);
    expect(pm.retryRate).toBeCloseTo(0.2);
    expect(pm.sweptCount).toBe(3);
  });

  it('failed 보정이 음수가 되지 않는다', () => {
    const result = buildQualityProfiles({
      base: [
        {
          agentType: 'BE',
          total: 2,
          failed: 1,
          failRate: 0.5,
          avgDurationMs: 0,
        },
      ],
      retries: [],
      swept: [{ agentType: 'BE', swept: 5 }],
      previews: [],
    });

    expect(result.agents[0].failed).toBe(0);
    expect(result.agents[0].failRate).toBe(0);
  });

  it('preview 프로필의 rejectRate = (cancelled+expired)/total', () => {
    const result = buildQualityProfiles({
      base: [],
      retries: [],
      swept: [],
      previews: [
        {
          kind: 'EVENING_BLOG_PUBLISH',
          applied: 2,
          cancelled: 1,
          expired: 1,
        },
      ],
    });

    const preview = result.previews[0];
    expect(preview.total).toBe(4);
    expect(preview.rejectRate).toBeCloseTo(0.5);
  });
});
