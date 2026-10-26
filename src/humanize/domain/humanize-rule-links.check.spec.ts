import {
  compareLinks,
  extractQuickRuleRow,
  hasUnresolvedDrift,
  normalizeSnapshot,
} from './humanize-rule-links.check';
import {
  HumanizeRuleLink,
  LinkCheckResult,
  LinkStatus,
} from './humanize-rule-links.type';

describe('humanize rule link checks', () => {
  it('normalizes line endings, trailing spaces, and outer whitespace', () => {
    expect(normalizeSnapshot({ source: '  first  \r\nsecond \r\n  ' })).toBe(
      'first\nsecond',
    );
  });

  it('finds a single quick-rule row by exact id', () => {
    const markdown = '| A-8 | target | S1 | fix |\n| A-80 | other | S1 | fix |';
    expect(extractQuickRuleRow({ markdown, ruleId: 'A-8' })).toBe(
      '| A-8 | target | S1 | fix |',
    );
    expect(extractQuickRuleRow({ markdown, ruleId: 'A-9' })).toBeNull();
    expect(() =>
      extractQuickRuleRow({
        markdown: `${markdown}\n| A-8 | duplicate | S1 | fix |`,
        ruleId: 'A-8',
      }),
    ).toThrow('A-8');
  });

  it('classifies same, changed, missing, and local-only links', () => {
    const links: HumanizeRuleLink[] = [
      {
        id: 'same',
        local: { file: 'a', text: 'a' },
        upstream: { kind: 'quick-rule', ruleId: 'A-1' },
        note: 'source',
      },
      {
        id: 'changed',
        local: { file: 'a', text: 'b' },
        upstream: { kind: 'quick-rule', ruleId: 'A-2' },
        note: 'source',
      },
      {
        id: 'missing',
        local: { file: 'a', text: 'c' },
        upstream: { kind: 'quick-rule', ruleId: 'A-3' },
        note: 'source',
      },
      {
        id: 'local',
        local: { file: 'a', text: 'd' },
        upstream: null,
        note: 'local rule',
      },
    ];
    expect(
      compareLinks({
        links,
        current: new Map([
          ['same', 'original\r\n'],
          ['changed', 'after'],
          ['missing', null],
        ]),
        snapshots: { same: 'original', changed: 'before', missing: 'before' },
      }),
    ).toEqual([
      { id: 'same', status: LinkStatus.SAME },
      {
        id: 'changed',
        status: LinkStatus.CHANGED,
        before: 'before',
        after: 'after',
      },
      { id: 'missing', status: LinkStatus.MISSING },
      { id: 'local', status: LinkStatus.LOCAL_ONLY },
    ]);
  });

  it.each([
    { status: LinkStatus.SAME, accept: false, expected: false },
    { status: LinkStatus.CHANGED, accept: false, expected: true },
    { status: LinkStatus.CHANGED, accept: true, expected: false },
    { status: LinkStatus.MISSING, accept: true, expected: true },
  ])(
    'detects unresolved drift for $status with accept=$accept',
    ({ status, accept, expected }) => {
      const result = { id: 'link', status } as LinkCheckResult;
      expect(hasUnresolvedDrift({ results: [result], accept })).toBe(expected);
    },
  );
});
