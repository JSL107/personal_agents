import { HumanizeRuleLink } from './humanize-rule-links';
import {
  compareLinks,
  extractQuickRuleRow,
  findLocalTextOccurrences,
  normalizeSnapshot,
} from './humanize-rule-links.check';

describe('humanize rule link checks', () => {
  it('normalizes line endings, trailing spaces, and outer whitespace', () => {
    expect(normalizeSnapshot('  first  \r\nsecond \r\n  ')).toBe(
      'first\nsecond',
    );
  });

  it('finds a single quick-rule row by exact id', () => {
    const markdown = '| A-8 | target | S1 | fix |\n| A-80 | other | S1 | fix |';
    expect(extractQuickRuleRow(markdown, 'A-8')).toBe(
      '| A-8 | target | S1 | fix |',
    );
    expect(extractQuickRuleRow(markdown, 'A-9')).toBeNull();
    expect(() =>
      extractQuickRuleRow(`${markdown}\n| A-8 | duplicate | S1 | fix |`, 'A-8'),
    ).toThrow('A-8');
  });

  it('classifies same, changed, missing, and local-only links', () => {
    const links: HumanizeRuleLink[] = [
      {
        id: 'same',
        local: { file: 'a', text: 'a' },
        upstream: { kind: 'quick-rule', ruleId: 'A-1' },
        upstreamSnapshot: 'original',
        note: 'source',
      },
      {
        id: 'changed',
        local: { file: 'a', text: 'b' },
        upstream: { kind: 'quick-rule', ruleId: 'A-2' },
        upstreamSnapshot: 'before',
        note: 'source',
      },
      {
        id: 'missing',
        local: { file: 'a', text: 'c' },
        upstream: { kind: 'quick-rule', ruleId: 'A-3' },
        upstreamSnapshot: 'before',
        note: 'source',
      },
      {
        id: 'local',
        local: { file: 'a', text: 'd' },
        upstream: null,
        upstreamSnapshot: null,
        note: 'local rule',
      },
    ];
    expect(
      compareLinks(
        links,
        new Map([
          ['same', 'original\r\n'],
          ['changed', 'after'],
          ['missing', null],
        ]),
      ),
    ).toEqual([
      { id: 'same', status: 'same' },
      { id: 'changed', status: 'changed', before: 'before', after: 'after' },
      { id: 'missing', status: 'missing' },
      { id: 'local', status: 'local-only' },
    ]);
  });

  it('counts non-overlapping local text occurrences', () => {
    expect(findLocalTextOccurrences('abc abc', 'abc')).toBe(2);
    expect(findLocalTextOccurrences('aaa', 'aa')).toBe(1);
    expect(findLocalTextOccurrences('abc', '')).toBe(0);
  });
});
