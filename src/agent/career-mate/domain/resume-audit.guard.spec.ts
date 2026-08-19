import { CareerProfileData, ResumeAuditData } from './career-mate.type';
import { applyAuditGuards } from './resume-audit.guard';

const accomplishment = (
  title: string,
  evidenceCount = 1,
): CareerProfileData['accomplishments'][number] => ({
  title,
  bullet: `${title} 성과를 만들었다.`,
  star: {
    situation: `${title} 상황`,
    task: `${title} 과제`,
    action: `${title} 행동`,
    result: `${title} 결과 30%`,
  },
  techTags: ['NestJS'],
  evidence: Array.from({ length: evidenceCount }, (_, index) => ({
    repo: 'owner/api',
    pr: index + 1,
    url: `https://example.com/${index + 1}`,
    mergedAt: '2026-08-01T00:00:00.000Z',
  })),
});

const PROFILE: CareerProfileData = {
  summary: '백엔드 엔지니어',
  skills: [],
  accomplishments: [
    accomplishment('근거 없음', 0),
    accomplishment('약한 성과'),
    accomplishment('판정 누락'),
    accomplishment('입증 성과'),
  ],
  meta: { githubLogin: 'octo', windowStart: '2026-01-01', prCount: 4 },
};

const data = (
  items: ResumeAuditData['items'],
  highlights: ResumeAuditData['highlights'] = [],
): ResumeAuditData => ({
  verdict: '감사 결과',
  items,
  highlights,
  jdFindings: [],
  rejectionRisks: [],
});

describe('applyAuditGuards', () => {
  it('입력에 없는 환각 title을 폐기한다', () => {
    const result = applyAuditGuards(
      data([
        {
          title: '환각 성과',
          status: 'WEAK',
          quote: '',
          why: '없다.',
          rewrite: null,
        },
      ]),
      PROFILE,
    );

    expect(result.items).not.toContainEqual(
      expect.objectContaining({ title: '환각 성과' }),
    );
    expect(result.guard.droppedTitles).toEqual(['환각 성과']);
  });

  it('강등된 성과는 앞세우기에서 반려한다', () => {
    // 모델은 자기가 PROVEN 이라 쓴 판정을 근거로 highlights 를 채운다. 그 판정이 가드에
    // 강등되고도 highlights 에 남으면, 같은 카드가 "근거 인용 실패" 와 "이걸 맨 위에" 를
    // 동시에 말한다.
    const result = applyAuditGuards(
      data(
        [
          {
            title: '입증 성과',
            status: 'PROVEN',
            quote: '원문에 없는 인용',
            why: '정량 결과가 있다.',
            rewrite: null,
          },
        ],
        [{ title: '입증 성과', reason: '공고의 MUST 와 대응' }],
      ),
      PROFILE,
    );

    expect(result.highlights).toEqual([]);
    expect(result.guard.droppedHighlights).toEqual(['입증 성과']);
  });

  it('근거 PR이 없어 MISSING으로 강제된 성과도 앞세우지 않는다', () => {
    const result = applyAuditGuards(
      data(
        [
          {
            title: '근거 없음',
            status: 'PROVEN',
            quote: '근거 없음 결과 30%',
            why: '수치가 있다.',
            rewrite: null,
          },
        ],
        [{ title: '근거 없음', reason: '수치가 선명하다' }],
      ),
      PROFILE,
    );

    expect(result.highlights).toEqual([]);
    expect(result.guard.droppedHighlights).toEqual(['근거 없음']);
  });

  it('앞세울 성과는 3개까지만 남기고 중복을 버린다', () => {
    const titles = ['약한 성과', '판정 누락', '입증 성과'];
    const provenItems = titles.map((title) => ({
      title,
      status: 'PROVEN' as const,
      quote: `${title} 결과 30%`,
      why: '수치가 있다.',
      rewrite: null,
    }));
    const result = applyAuditGuards(
      data(provenItems, [
        { title: '약한 성과', reason: '1순위' },
        { title: '약한 성과', reason: '중복' },
        { title: '판정 누락', reason: '2순위' },
        { title: '입증 성과', reason: '3순위' },
      ]),
      PROFILE,
    );

    expect(result.highlights.map((highlight) => highlight.title)).toEqual([
      '약한 성과',
      '판정 누락',
      '입증 성과',
    ]);
    expect(result.guard.droppedHighlights).toEqual(['약한 성과']);
  });

  it('원문에 없는 quote의 PROVEN을 WEAK로 강등한다', () => {
    const input = data([
      {
        title: '입증 성과',
        status: 'PROVEN',
        quote: '원문에 없는 인용',
        why: '정량 결과가 있다.',
        rewrite: null,
      },
    ]);

    const result = applyAuditGuards(input, PROFILE);

    expect(result.items.find((item) => item.title === '입증 성과')).toEqual(
      expect.objectContaining({
        status: 'WEAK',
        why: '[근거 인용 실패] 정량 결과가 있다.',
      }),
    );
    expect(result.guard.demotedTitles).toEqual(['입증 성과']);
  });

  it('프롬프트의 결과 라벨까지 복사한 정상 quote는 PROVEN을 유지한다', () => {
    const result = applyAuditGuards(
      data([
        {
          title: '입증 성과',
          status: 'PROVEN',
          quote: '결과: 입증 성과 결과 30%',
          why: '정량 결과가 있다.',
          rewrite: null,
        },
      ]),
      PROFILE,
    );

    expect(
      result.items.find((item) => item.title === '입증 성과')?.status,
    ).toBe('PROVEN');
    expect(result.guard.demotedTitles).toEqual([]);
  });

  it('원문 여러 줄에서 필요한 줄만 골라 인용해도 PROVEN을 유지한다', () => {
    // 실제 모델은 상황/행동처럼 떨어진 줄만 골라 개행으로 이어 붙여 인용한다(중간 줄 생략).
    // quote 를 한 덩어리로 대조하면 이런 정당한 인용이 전부 강등된다.
    const result = applyAuditGuards(
      data([
        {
          title: '입증 성과',
          status: 'PROVEN',
          quote: '상황: 입증 성과 상황\n결과: 입증 성과 결과 30%',
          why: '정량 결과가 있다.',
          rewrite: null,
        },
      ]),
      PROFILE,
    );

    expect(
      result.items.find((item) => item.title === '입증 성과')?.status,
    ).toBe('PROVEN');
    expect(result.guard.demotedTitles).toEqual([]);
  });

  it('여러 줄 인용 중 한 줄이라도 원문에 없으면 강등한다', () => {
    const result = applyAuditGuards(
      data([
        {
          title: '입증 성과',
          status: 'PROVEN',
          quote: '상황: 입증 성과 상황\n결과: 지어낸 수치 99%',
          why: '정량 결과가 있다.',
          rewrite: null,
        },
      ]),
      PROFILE,
    );

    expect(
      result.items.find((item) => item.title === '입증 성과')?.status,
    ).toBe('WEAK');
    expect(result.guard.demotedTitles).toEqual(['입증 성과']);
  });

  it('라벨만 복사한 quote는 근거가 없으므로 PROVEN을 유지하지 못한다', () => {
    const result = applyAuditGuards(
      data([
        {
          title: '입증 성과',
          status: 'PROVEN',
          quote: '결과: ',
          why: '정량 결과가 있다.',
          rewrite: null,
        },
      ]),
      PROFILE,
    );

    expect(
      result.items.find((item) => item.title === '입증 성과')?.status,
    ).toBe('WEAK');
    expect(result.guard.demotedTitles).toEqual(['입증 성과']);
  });

  it('원문 단어 몇 글자만 집어낸 quote는 PROVEN을 유지하지 못한다', () => {
    const result = applyAuditGuards(
      data([
        {
          title: '입증 성과',
          status: 'PROVEN',
          quote: '결과',
          why: '정량 결과가 있다.',
          rewrite: null,
        },
      ]),
      PROFILE,
    );

    expect(
      result.items.find((item) => item.title === '입증 성과')?.status,
    ).toBe('WEAK');
    expect(result.guard.demotedTitles).toEqual(['입증 성과']);
  });

  it('강등 가드를 우회한 원형 출력은 같은 WEAK 단언을 통과하지 못한다', () => {
    const raw = data([
      {
        title: '입증 성과',
        status: 'PROVEN',
        quote: '원문에 없는 인용',
        why: '정량 결과가 있다.',
        rewrite: null,
      },
    ]);

    expect(() => expect(raw.items[0].status).toBe('WEAK')).toThrow();
  });

  it('evidence가 0건이면 LLM 판정과 무관하게 MISSING으로 강제한다', () => {
    const result = applyAuditGuards(
      data([
        {
          title: '근거 없음',
          status: 'PROVEN',
          quote: '근거 없음 결과 30%',
          why: '정량 결과가 있다.',
          rewrite: null,
        },
      ]),
      PROFILE,
    );

    // 판정만 뒤집고 why 를 두면 "[근거없음] … — 정량 결과가 있다" 로 서로 반대되는 줄이 뜬다.
    expect(result.items.find((item) => item.title === '근거 없음')).toEqual(
      expect.objectContaining({
        status: 'MISSING',
        why: '[근거 PR 없음] 정량 결과가 있다.',
      }),
    );
    expect(result.guard.forcedMissing).toEqual(['근거 없음']);
  });

  it('LLM이 누락한 성과를 UNJUDGED로 채운다', () => {
    const result = applyAuditGuards(data([]), PROFILE);

    expect(result.items.find((item) => item.title === '판정 누락')).toEqual({
      title: '판정 누락',
      status: 'UNJUDGED',
      quote: '',
      why: '모델이 이 성과를 판정하지 않았습니다.',
      rewrite: null,
    });
    expect(result.guard.unjudgedTitles).toContain('판정 누락');
  });

  it('WEAK 인데 rewrite 가 없으면 파싱을 깨뜨리지 않고 rewriteMissing 으로 드러낸다', () => {
    // 파싱 단계에서 거부하면 항목 하나의 누락으로 감사 25건이 통째로 사라진다.
    // 대신 "고칠 문장을 못 받은 자리"로 남겨 사용자와 보고에 드러낸다.
    const result = applyAuditGuards(
      data([
        {
          title: '약한 성과',
          status: 'WEAK',
          quote: '약한 성과 성과를 만들었다.',
          why: '수치가 없다.',
          rewrite: null,
        },
      ]),
      PROFILE,
    );

    expect(result.guard.rewriteMissing).toEqual(['약한 성과']);
  });

  it('강등으로 WEAK 이 된 항목도 rewriteMissing 집계에 든다', () => {
    // 모델이 PROVEN 으로 낸 항목은 rewrite 를 주지 않는다. 가드가 그걸 WEAK 로 내리면
    // 고칠 문장 없는 WEAK 가 생기므로, 집계는 강등 이후에 해야 한다.
    const result = applyAuditGuards(
      data([
        {
          title: '입증 성과',
          status: 'PROVEN',
          quote: '원문에 없는 인용',
          why: '정량 결과가 있다.',
          rewrite: null,
        },
      ]),
      PROFILE,
    );

    expect(result.guard.demotedTitles).toEqual(['입증 성과']);
    expect(result.guard.rewriteMissing).toEqual(['입증 성과']);
  });

  it('MISSING 은 인용할 원문이 없어 rewriteMissing 에 넣지 않는다', () => {
    const result = applyAuditGuards(
      data([
        {
          title: '근거 없음',
          status: 'WEAK',
          quote: '근거 없음 성과를 만들었다.',
          why: '수치가 없다.',
          rewrite: null,
        },
      ]),
      PROFILE,
    );

    // evidence 0 건이라 MISSING 으로 강제된다 → rewrite 대상이 아니다.
    expect(result.guard.forcedMissing).toEqual(['근거 없음']);
    expect(result.guard.rewriteMissing).toEqual([]);
  });

  it('MISSING, WEAK, UNJUDGED, PROVEN 순서로 정렬한다', () => {
    const result = applyAuditGuards(
      data([
        {
          title: '입증 성과',
          status: 'PROVEN',
          quote: '입증 성과 결과 30%',
          why: '정량 결과가 있다.',
          rewrite: null,
        },
        {
          title: '약한 성과',
          status: 'WEAK',
          quote: '약한 성과 행동',
          why: '규모가 없다.',
          rewrite: null,
        },
        {
          title: '근거 없음',
          status: 'WEAK',
          quote: '',
          why: '근거가 없다.',
          rewrite: null,
        },
      ]),
      PROFILE,
    );

    expect(result.items.map((item) => item.status)).toEqual([
      'MISSING',
      'WEAK',
      'UNJUDGED',
      'PROVEN',
    ]);
  });
});
