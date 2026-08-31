import { CareerProfileData, ProfileAccomplishment } from './career-mate.type';
import { preserveImpactContexts } from './preserve-impact-context';

const makeAccomplishment = (
  pr: number,
  impactContext?: string,
): ProfileAccomplishment => ({
  title: `성과 ${pr}`,
  bullet: 'bullet',
  star: { situation: 's', task: 't', action: 'a', result: 'r' },
  techTags: [],
  evidence: [{ repo: 'o/r', pr, url: `https://x/pull/${pr}`, mergedAt: null }],
  ...(impactContext ? { impactContext } : {}),
});

const makeProfile = (
  accomplishments: ProfileAccomplishment[],
): CareerProfileData => ({
  summary: 's',
  skills: [],
  accomplishments,
  meta: { githubLogin: 'me', windowStart: '2026-08-01', prCount: 1 },
});

describe('preserveImpactContexts', () => {
  it('맥락이 빠진 새 성과에 옛 맥락을 되살린다 (재회고·프로필 재생성)', () => {
    const previous = makeProfile([
      makeAccomplishment(1, '결제 실패율 3%→0.5%'),
    ]);
    const next = makeProfile([makeAccomplishment(1)]);

    const result = preserveImpactContexts({ previous, next });

    expect(result.accomplishments[0].impactContext).toBe('결제 실패율 3%→0.5%');
    // 나머지 필드는 새 성과 그대로여야 한다 — 옛 성과로 되돌리는 게 아니다.
    expect(result.accomplishments[0].title).toBe('성과 1');
  });

  it('새로 적은 맥락이 옛 맥락을 이긴다', () => {
    const previous = makeProfile([makeAccomplishment(1, '옛 맥락')]);
    const next = makeProfile([makeAccomplishment(1, '새 맥락')]);

    expect(
      preserveImpactContexts({ previous, next }).accomplishments[0]
        .impactContext,
    ).toBe('새 맥락');
  });

  it('짝을 못 찾은 옛 맥락은 아무 성과에나 붙이지 않는다', () => {
    const previous = makeProfile([
      makeAccomplishment(1, '결제 실패율 3%→0.5%'),
    ]);
    const next = makeProfile([makeAccomplishment(2)]);

    expect(
      preserveImpactContexts({ previous, next }).accomplishments[0],
    ).not.toHaveProperty('impactContext');
  });

  it('옛 프로필이 없거나 맥락이 하나도 없으면 입력을 그대로 돌려준다', () => {
    const next = makeProfile([makeAccomplishment(1)]);

    expect(preserveImpactContexts({ previous: null, next })).toBe(next);
    expect(
      preserveImpactContexts({
        previous: makeProfile([makeAccomplishment(1)]),
        next,
      }),
    ).toBe(next);
  });

  it('보정 전 `pr: "#984"` 형태와도 짝이 맞는다 (키 정규화)', () => {
    const stale = makeAccomplishment(984, '월 2,000건 수동 재시도 제거');
    stale.evidence[0].pr = '#984' as unknown as number;

    const result = preserveImpactContexts({
      previous: makeProfile([stale]),
      next: makeProfile([makeAccomplishment(984)]),
    });

    expect(result.accomplishments[0].impactContext).toBe(
      '월 2,000건 수동 재시도 제거',
    );
  });
});
