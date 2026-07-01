import {
  CareerProfileData,
  ProfileAccomplishment,
} from '../domain/career-mate.type';
import { mergeAccomplishment } from './merge-accomplishment';

const acc = (pr: number, bullet: string): ProfileAccomplishment => ({
  title: `t${pr}`,
  bullet,
  star: { situation: 's', task: 't', action: 'a', result: 'r' },
  techTags: ['NestJS'],
  evidence: [
    { repo: 'o/r', pr, url: `https://x/pull/${pr}`, mergedAt: '2026-06-30' },
  ],
});

describe('mergeAccomplishment', () => {
  it('프로필이 없으면 최소 프로필을 만든다', () => {
    const out = mergeAccomplishment({
      latest: null,
      accomplishment: acc(1692, 'first'),
      githubLogin: 'me',
      todayIsoDate: '2026-07-01',
    });
    expect(out.accomplishments).toHaveLength(1);
    expect(out.skills).toEqual([]);
    expect(out.meta.prCount).toBe(1);
    expect(out.meta.windowStart).toBe('2026-06-30');
    expect(out.summary).toBe('first');
  });

  it('기존 프로필에 새 PR 을 append 한다', () => {
    const latest: CareerProfileData = {
      summary: 'sum',
      skills: [],
      accomplishments: [acc(1, 'old')],
      meta: { githubLogin: 'me', windowStart: '2026-01-01', prCount: 1 },
    };
    const out = mergeAccomplishment({
      latest,
      accomplishment: acc(1692, 'new'),
      githubLogin: 'me',
      todayIsoDate: '2026-07-01',
    });
    expect(out.accomplishments.map((a) => a.evidence[0].pr).sort()).toEqual([
      1, 1692,
    ]);
    expect(out.meta.prCount).toBe(2);
    expect(out.meta.windowStart).toBe('2026-01-01');
  });

  it('같은 PR 재회고 시 교체(중복 누적 방지)', () => {
    const latest: CareerProfileData = {
      summary: 'sum',
      skills: [],
      accomplishments: [acc(1692, 'v1')],
      meta: { githubLogin: 'me', windowStart: '2026-01-01', prCount: 1 },
    };
    const out = mergeAccomplishment({
      latest,
      accomplishment: acc(1692, 'v2'),
      githubLogin: 'me',
      todayIsoDate: '2026-07-01',
    });
    expect(out.accomplishments).toHaveLength(1);
    expect(out.accomplishments[0].bullet).toBe('v2');
    expect(out.meta.prCount).toBe(1);
  });
});
