import { formatStudyBrief } from './study-brief.formatter';

describe('formatStudyBrief', () => {
  it('CONCEPT 카드를 렌더한다', () => {
    const rendered = formatStudyBrief({
      topic: 'Durable execution',
      verdict: {
        kind: 'CONCEPT',
        whyNow: '재시도 설계에 필요',
        whereItLands: 'src/agent-run 모듈',
        readingPlan: '공식 문서부터',
        minutes: 30,
      },
      reportMd: '조사 전문',
    });

    expect(rendered.summary).toContain('📚 *오늘의 공부 — Durable execution*');
    expect(rendered.summary).toContain(
      '이 주제는 src/agent-run 모듈에 닿는다. 재시도 설계에 필요',
    );
    expect(rendered.summary).toContain('*왜 지금 나한테*');
    expect(rendered.summary).toContain('src/agent-run 모듈');
    expect(rendered.full).toBe('조사 전문');
  });

  it('TOOL 카드를 렌더하고 caution이 없으면 주의 줄을 생략한다', () => {
    const rendered = formatStudyBrief({
      topic: 'context7',
      verdict: {
        kind: 'TOOL',
        whatImproves: '문서 검색 개선',
        adoptionCost: '낮음',
        installHint: 'codex mcp add context7',
        minutes: 10,
      },
      reportMd: '조사 전문',
    });

    expect(rendered.summary).toContain('🔧 *오늘의 도구 — context7*');
    expect(rendered.summary).toContain('설치 10분');
    expect(rendered.summary).not.toContain('*주의*');
  });

  it('LLM 출력의 mrkdwn control char를 escape한다', () => {
    const rendered = formatStudyBrief({
      topic: 'x*y_z~q<r>&`s`',
      verdict: {
        kind: 'TOOL',
        whatImproves: '*bold* & <tag>',
        adoptionCost: '_cost_',
        installHint: '`command`',
        caution: '~warn~',
        minutes: 10,
      },
      reportMd: '*report* & <tag> `code`',
    });

    expect(rendered.summary).toContain('x\\*y\\_z\\~q&lt;r&gt;&amp;\\`s\\`');
    expect(rendered.summary).toContain('\\*bold\\* &amp; &lt;tag&gt;');
    expect(rendered.full).toBe('\\*report\\* &amp; &lt;tag&gt; \\`code\\`');
  });

  it('조사 전문이 3000자를 넘으면 잘라 truncated를 표시한다', () => {
    const rendered = formatStudyBrief({
      topic: 'x',
      verdict: {
        kind: 'CONCEPT',
        whyNow: 'why',
        whereItLands: 'where',
        readingPlan: 'read',
        minutes: 1,
      },
      reportMd: 'a'.repeat(4000),
    });

    expect(rendered.full.length).toBeLessThanOrEqual(3000);
    expect(rendered.truncated).toBe(true);
  });
});
