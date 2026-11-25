import { isCompanyRepo, parseAiWeeklyCompanyScope } from './ai-weekly-company';

describe('parseAiWeeklyCompanyScope', () => {
  it('빈 값은 회사 기준 없음으로 읽는다', () => {
    expect(
      parseAiWeeklyCompanyScope({
        orgRaw: undefined,
        pathKeywordsRaw: undefined,
      }),
    ).toEqual({
      org: null,
      pathKeywords: [],
    });
    expect(
      parseAiWeeklyCompanyScope({ orgRaw: '  ', pathKeywordsRaw: ' , ' }),
    ).toEqual({
      org: null,
      pathKeywords: [],
    });
  });

  it('조직명과 콤마 구분 키워드를 다듬어 읽는다', () => {
    expect(
      parseAiWeeklyCompanyScope({
        orgRaw: ' acme-corp ',
        pathKeywordsRaw: 'acme-, example',
      }),
    ).toEqual({
      org: 'acme-corp',
      pathKeywords: ['acme-', 'example'],
    });
  });
});

describe('isCompanyRepo', () => {
  const scope = { org: 'acme-corp', pathKeywords: [] };

  it('소유자가 조직명과 같을 때만 회사 레포다', () => {
    expect(isCompanyRepo({ repo: 'Acme-Corp/api', scope })).toBe(true);
    expect(isCompanyRepo({ repo: 'acme-corp-old/api', scope })).toBe(false);
    expect(isCompanyRepo({ repo: 'someone/acme-corp', scope })).toBe(false);
  });

  it('조직명이 없으면 어떤 레포도 회사가 아니다', () => {
    expect(
      isCompanyRepo({
        repo: 'acme-corp/api',
        scope: { org: null, pathKeywords: [] },
      }),
    ).toBe(false);
  });
});
