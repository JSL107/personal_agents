import { formatDocsAudit } from './docs-audit.formatter';

it('drift + 제안 있으면 mrkdwn 텍스트, 깨끗하면 빈 문자열', () => {
  const text = formatDocsAudit(
    {
      deterministic: {
        inSync: false,
        details: ['docs:check FAIL — agent-catalog'],
      },
      proposals: [
        {
          filePath: 'README.md',
          proposedDiff: 'd',
          rationale: 'r',
          score: 95,
          confirmed: true,
        },
      ],
    },
    '2026-06-29',
  );
  expect(text).toContain('docs:check');
  expect(text).toContain('README.md');
  expect(
    formatDocsAudit(
      { deterministic: { inSync: true, details: [] }, proposals: [] },
      '2026-06-29',
    ),
  ).toBe('');
});
