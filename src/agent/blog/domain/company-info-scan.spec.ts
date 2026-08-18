import { scanForbiddenTerms } from './company-info-scan';

describe('scanForbiddenTerms', () => {
  it('설정 금지어를 대소문자와 무관하게 태그에서도 찾는다', () => {
    const hits = scanForbiddenTerms(
      { body: '기술 맥락은 유지한다.', tags: ['SchoolBell'] },
      ['schoolbell'],
    );

    expect(hits).toEqual([
      expect.objectContaining({ term: 'schoolbell', kind: 'term' }),
    ]);
  });

  it('사내 버전 코드네임이 남은 문장을 차단한다', () => {
    const hits = scanForbiddenTerms(
      {
        body: '학교종이 백엔드는 레거시 v4(PHP)와 신규 서비스를 함께 운영했다.',
        tags: [],
      },
      ['학교종이'],
    );

    expect(hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ term: '학교종이', kind: 'term' }),
        expect.objectContaining({ term: 'v4', kind: 'pattern' }),
      ]),
    );
  });

  it('기관명을 차단한다', () => {
    const hits = scanForbiddenTerms(
      { body: '영도초등학교 계정의 정합성을 복구했다.', tags: [] },
      [],
    );

    expect(hits).toEqual([
      expect.objectContaining({ term: '영도초등학교', kind: 'pattern' }),
    ]);
  });

  it('사내 식별자 접두사를 차단한다', () => {
    const hits = scanForbiddenTerms(
      { body: 'mig_prep_cmc_current_credit 값을 이전했다.', tags: [] },
      [],
    );

    expect(hits).toEqual([
      expect.objectContaining({
        term: 'mig_prep_cmc_current_credit',
        kind: 'pattern',
      }),
    ]);
  });

  it('PHP 소스 파일명을 차단한다', () => {
    const hits = scanForbiddenTerms(
      { body: 'HandlePendingPurchases.php의 책임을 분리했다.', tags: [] },
      [],
    );

    expect(hits).toEqual([
      expect.objectContaining({
        term: 'HandlePendingPurchases.php',
        kind: 'pattern',
      }),
    ]);
  });

  it('마스킹된 기술 글은 hit 없이 통과한다', () => {
    const hits = scanForbiddenTerms(
      {
        body: '레거시 PHP와 신규 Node 서비스가 공유 DB를 쓸 때 멱등성 키를 기준으로 정합성을 지켰다.',
        tags: ['migration', 'idempotency'],
      },
      ['schoolbell'],
    );

    expect(hits).toEqual([]);
  });

  it('사내 포인트 금액 표기를 차단한다', () => {
    const hits = scanForbiddenTerms(
      { body: '초과 지급 합계는 100,000P였다.', tags: [] },
      [],
    );

    expect(hits).toEqual([
      expect.objectContaining({ term: '100,000P', kind: 'pattern' }),
    ]);
  });

  it('외부 저장소 링크를 차단한다', () => {
    const hits = scanForbiddenTerms(
      {
        body: 'https://github.com/some-org/sbe-api-v4/pull/261',
        tags: [],
      },
      [],
    );

    expect(hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          term: 'github.com/some-org/sbe-api-v4',
          kind: 'pattern',
        }),
      ]),
    );
  });

  it('본인 저장소 링크는 허용한다', () => {
    const hits = scanForbiddenTerms(
      { body: 'https://github.com/JSL107/JSL107.github.io', tags: [] },
      [],
    );

    expect(hits).toEqual([]);
  });
});
