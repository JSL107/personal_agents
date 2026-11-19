import { RubricItemKey } from '../../docs-audit/domain/docs-audit-rubric.type';
import { formatDocsAudit } from './docs-audit.formatter';

it('drift + 제안 있으면 mrkdwn 텍스트, 깨끗하면 빈 문자열', () => {
  const text = formatDocsAudit(
    {
      deterministic: {
        inSync: false,
        details: ['docs:check FAIL: agent-catalog'],
      },
      proposals: [
        {
          filePath: 'README.md',
          edits: [{ oldString: 'a', newString: 'b' }],
          rationale: 'r',
          score: 95,
          failedRequired: [],
          confirmed: true,
        },
      ],
      revision: null,
      candidateFileCount: 1,
    },
    '2026-06-29',
  );
  expect(text).toContain('docs:check');
  expect(text).toContain('README.md');
  expect(
    formatDocsAudit(
      {
        deterministic: { inSync: true, details: [] },
        proposals: [],
        revision: null,
        candidateFileCount: 0,
      },
      '2026-06-29',
    ),
  ).toBe('');
});

it('확정은 점수, 미확정은 실패한 필수 항목을 보여 준다', () => {
  const base = {
    filePath: 'README.md',
    edits: [{ oldString: 'a', newString: 'b' }],
    rationale: 'r',
  };
  const text = formatDocsAudit(
    {
      deterministic: { inSync: true, details: [] },
      proposals: [
        { ...base, score: 95, failedRequired: [], confirmed: true },
        {
          ...base,
          score: 60,
          failedRequired: [RubricItemKey.COMPLETE, RubricItemKey.SCOPED],
          confirmed: false,
        },
      ],
      revision: null,
      candidateFileCount: 1,
    },
    '2026-11-19',
  );
  expect(text).toContain('✅ 검증됨 · 95점');
  expect(text).toContain('⚠️ 미확정 · 실패: complete, scoped');
});
