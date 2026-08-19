import { ProfileAccomplishment } from './career-mate.type';
import {
  EvidencePullRequest,
  reconcileAccomplishmentEvidence,
} from './reconcile-accomplishment-evidence';

const accomplishment = (): ProfileAccomplishment => ({
  title: '성과',
  bullet: '성과 요약',
  star: { situation: '상황', task: '과제', action: '행동', result: '결과' },
  techTags: ['TypeScript'],
  evidence: [
    {
      repo: 'Owner/Repository',
      pr: 10,
      url: 'https://github.com/Owner/Repository/pull/10',
      mergedAt: 'LLM-값',
    },
    {
      repo: 'owner/repository',
      pr: 20,
      url: 'https://github.com/owner/repository/pull/20',
      mergedAt: '그대로-유지',
    },
  ],
});

const pullRequests: EvidencePullRequest[] = [
  {
    repo: 'owner/repository',
    number: 10,
    mergedAt: '2026-08-17T08:03:46Z',
  },
];

describe('reconcileAccomplishmentEvidence', () => {
  it('repo 대소문자와 무관하게 입력 PR의 실제 mergedAt으로 덮어쓴다', () => {
    const result = reconcileAccomplishmentEvidence({
      accomplishments: [accomplishment()],
      pullRequests,
    });

    expect(result[0].evidence[0].mergedAt).toBe('2026-08-17T08:03:46Z');
  });

  it('입력 PR에 없는 근거는 원래 mergedAt을 유지한다', () => {
    const result = reconcileAccomplishmentEvidence({
      accomplishments: [accomplishment()],
      pullRequests,
    });

    expect(result[0].evidence[1].mergedAt).toBe('그대로-유지');
  });

  it('open PR의 null mergedAt을 null로 유지한다', () => {
    const result = reconcileAccomplishmentEvidence({
      accomplishments: [accomplishment()],
      pullRequests: [
        {
          repo: 'OWNER/REPOSITORY',
          pr: 10,
          mergedAt: null,
        },
      ],
    });

    expect(result[0].evidence[0].mergedAt).toBeNull();
  });

  it('원본 accomplishment와 evidence 객체를 변형하지 않는다', () => {
    const source = accomplishment();
    const sourceEvidence = source.evidence[0];

    const result = reconcileAccomplishmentEvidence({
      accomplishments: [source],
      pullRequests,
    });

    expect(source.evidence[0].mergedAt).toBe('LLM-값');
    expect(result[0]).not.toBe(source);
    expect(result[0].evidence[0]).not.toBe(sourceEvidence);
  });
  it('모델이 "#10" 처럼 문자열로 흘린 pr 을 숫자로 눌러 담아 백필 키를 맞춘다', () => {
    const source = accomplishment();
    source.evidence[0].pr = '#10' as unknown as number;

    const result = reconcileAccomplishmentEvidence({
      accomplishments: [source],
      pullRequests,
    });

    expect(result[0].evidence[0].pr).toBe(10);
    expect(result[0].evidence[0].mergedAt).toBe('2026-08-17T08:03:46Z');
  });

  it('숫자로 읽을 수 없는 pr 은 추측하지 않고 그대로 둔다', () => {
    const source = accomplishment();
    source.evidence[0].pr = 'unknown' as unknown as number;

    const result = reconcileAccomplishmentEvidence({
      accomplishments: [source],
      pullRequests,
    });

    expect(result[0].evidence[0].pr).toBe('unknown');
    expect(result[0].evidence[0].mergedAt).toBe('LLM-값');
  });

  // 숫자만 긁어모으면 형식을 벗어난 값이 **다른 PR** 이 된다("1.5"→15, "PR-12-extra"→12).
  // 그 번호가 우연히 실재하면 남의 머지 시각을 근거에 심고 slug·dedup 키까지 그 PR 을 가리킨다.
  it.each(['1.5', 'PR-12-extra', '-12', '984#985', 984.5, -12, 0])(
    '허용 형식을 벗어난 pr %p 은 다른 번호로 바꾸지 않는다',
    (raw) => {
      const source = accomplishment();
      source.evidence[0].pr = raw as unknown as number;

      const result = reconcileAccomplishmentEvidence({
        accomplishments: [source],
        pullRequests,
      });

      expect(result[0].evidence[0].pr).toBe(raw);
    },
  );

  it('형식을 벗어난 pr 은 권위 PR 과 우연히 겹쳐도 mergedAt 을 덮어쓰지 않는다', () => {
    const source = accomplishment();
    // 숫자만 남기면 10 이 되어 입력 PR 목록의 10 번과 맞물린다.
    source.evidence[0].pr = 'PR-10-extra' as unknown as number;

    const result = reconcileAccomplishmentEvidence({
      accomplishments: [source],
      pullRequests,
    });

    expect(result[0].evidence[0].mergedAt).toBe('LLM-값');
  });
});
