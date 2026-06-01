import { SearchAgentRunsResult } from '../../agent-run/application/search-agent-runs.usecase';
import { formatSearchRuns } from './search-runs.formatter';

describe('formatSearchRuns', () => {
  const buildResult = (
    overrides: Partial<SearchAgentRunsResult> = {},
  ): SearchAgentRunsResult => ({
    keyword: '결제',
    rows: [],
    truncated: false,
    ...overrides,
  });

  it('rows 0 — 빈 결과 안내 텍스트 + 키워드 일반화 권장', () => {
    const text = formatSearchRuns(buildResult({ rows: [], truncated: false }));
    expect(text).toContain('"결제" 매칭 0건');
    expect(text).toContain('일반화');
  });

  it('rows N — 헤더에 건수 + 각 row 가 `[agentType #id]` 형태로 노출', () => {
    const text = formatSearchRuns(
      buildResult({
        rows: [
          {
            id: 42,
            agentType: 'PM',
            endedAt: new Date('2026-05-30T10:00:00Z'),
            snippet: '결제 검증 API 추가',
          },
          {
            id: 38,
            agentType: 'CTO',
            endedAt: new Date('2026-05-29T10:00:00Z'),
            snippet: 'BE 분배 결과',
          },
        ],
      }),
    );

    expect(text).toContain('매칭 2건');
    expect(text).toContain('[PM #42]');
    expect(text).toContain('[CTO #38]');
    expect(text).toContain('2026-05-30');
    expect(text).toContain('2026-05-29');
    expect(text).toContain('결제 검증');
    expect(text).toContain('/retry-run');
  });

  it('truncated=true — 헤더에 "(더 있을 수 있음)" + footer 에 키워드 좁히기 권장', () => {
    const text = formatSearchRuns(
      buildResult({
        rows: [
          {
            id: 1,
            agentType: 'PM',
            endedAt: new Date('2026-05-30T10:00:00Z'),
            snippet: 'x',
          },
        ],
        truncated: true,
      }),
    );

    expect(text).toContain('(더 있을 수 있음)');
    expect(text).toContain('좁히려면');
  });

  it('snippet 의 Slack mrkdwn 메타 문자 (* _ `) 는 escape 되어 layout 보존', () => {
    const text = formatSearchRuns(
      buildResult({
        rows: [
          {
            id: 1,
            agentType: 'PM',
            endedAt: new Date('2026-05-30T10:00:00Z'),
            snippet: '*bold* _italic_ `code`',
          },
        ],
      }),
    );

    expect(text).toContain('\\*bold\\*');
    expect(text).toContain('\\_italic\\_');
    expect(text).toContain('\\`code\\`');
  });

  it('snippet 의 angle bracket / & 도 entity 화 — Slack link/mention 형태 차단', () => {
    const text = formatSearchRuns(
      buildResult({
        rows: [
          {
            id: 1,
            agentType: 'PM',
            endedAt: new Date('2026-05-30T10:00:00Z'),
            snippet: '<https://evil.com|click> & <@U999>',
          },
        ],
      }),
    );

    // entity 화로 링크/멘션 렌더링 차단.
    expect(text).toContain('&lt;');
    expect(text).toContain('&gt;');
    expect(text).toContain('&amp;');
    expect(text).not.toContain('<https://evil.com');
    expect(text).not.toContain('<@U999>');
  });

  it('keyword 자체에 mrkdwn meta 문자 있어도 header escape — layout 깨짐 없음', () => {
    const text = formatSearchRuns(
      buildResult({
        keyword: '*bold*',
        rows: [],
      }),
    );

    expect(text).toContain('\\*bold\\*');
    expect(text).not.toContain('"*bold*"');
  });

  it('UTC 자정 근처는 KST 변환으로 다음 날짜로 노출', () => {
    // 2026-05-30T15:30:00Z = KST 2026-05-31 00:30 — KST 표기는 5/31.
    const text = formatSearchRuns(
      buildResult({
        rows: [
          {
            id: 1,
            agentType: 'PM',
            endedAt: new Date('2026-05-30T15:30:00Z'),
            snippet: 'x',
          },
        ],
      }),
    );

    expect(text).toContain('2026-05-31');
    expect(text).not.toContain('2026-05-30 —');
  });
});
