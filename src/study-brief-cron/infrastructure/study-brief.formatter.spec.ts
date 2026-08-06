import { formatStudyBrief } from './study-brief.formatter';

describe('formatStudyBrief', () => {
  it('link 모드는 제목, 세 줄 요약, Notion 링크만 렌더한다', () => {
    const rendered = formatStudyBrief({
      mode: 'link',
      notionUrl: 'https://notion.so/PAGE',
      topic: 'Durable execution',
      verdict: {
        kind: 'CONCEPT',
        whyNow: '재시도 설계에 필요',
        whereItLands: 'src/agent-run 모듈',
        minutes: 30,
      },
      reportMd:
        '## 세 줄 요약\n첫 문장\n둘째 문장\n셋째 문장\n\n## 알아야 할 것\n- 상세',
    });

    expect(rendered.summary).toContain('오늘의 공부 — Durable execution');
    expect(rendered.summary).toContain('첫 문장\n둘째 문장\n셋째 문장');
    expect(rendered.summary).toContain(
      '<https://notion.so/PAGE|Notion에서 전체 읽기>',
    );
    expect(rendered.summary).not.toContain('왜 지금 나한테');
    expect(rendered.summary).not.toContain('상세');
    expect(rendered.summaryFallback).toBe(false);
  });

  it('세 줄 요약 heading이 없으면 첫 문단 3줄과 fallback 신호를 반환한다', () => {
    const rendered = formatStudyBrief({
      mode: 'link',
      notionUrl: 'https://notion.so/PAGE',
      topic: 'Topic',
      verdict: {
        kind: 'CONCEPT',
        whyNow: 'why',
        whereItLands: 'where',
        minutes: 10,
      },
      reportMd: '첫 줄\n둘째 줄\n셋째 줄\n넷째 줄\n\n다음 문단',
    });

    expect(rendered.summary).toContain('첫 줄\n둘째 줄\n셋째 줄');
    expect(rendered.summary).not.toContain('넷째 줄');
    expect(rendered.summaryFallback).toBe(true);
  });

  it('CONCEPT 카드를 필드 목록으로 렌더한다', () => {
    const rendered = formatStudyBrief({
      topic: 'Durable execution',
      verdict: {
        kind: 'CONCEPT',
        whyNow: '재시도 설계에 필요',
        whereItLands: 'src/agent-run 모듈',
        minutes: 30,
      },
      reportMd: '조사 전문',
    });

    expect(rendered.summary).toBe(
      [
        '📚 *오늘의 공부 — Durable execution*   ·  30분',
        '',
        '*왜 지금 나한테* 재시도 설계에 필요',
        '*어디에 닿나* src/agent-run 모듈',
      ].join('\n'),
    );
    expect(rendered.summary).not.toContain('*읽을 것*');
    expect(rendered.full).toBe('조사 전문');
  });

  it('CONCEPT 카드가 필드 값을 서두에서 중복하지 않는다', () => {
    const whyNow = '멀티턴 상태 관리 학습이 필요';
    const whereItLands = 'router 대화 맥락';
    const rendered = formatStudyBrief({
      topic: 'LangGraph 체크포인터',
      verdict: {
        kind: 'CONCEPT',
        whyNow,
        whereItLands,
        minutes: 20,
      },
      reportMd: '조사 전문',
    });

    expect(rendered.summary.split(whyNow)).toHaveLength(2);
    expect(rendered.summary.split(whereItLands)).toHaveLength(2);
  });

  it('TOOL 카드를 렌더하고 caution이 없으면 주의 줄을 생략한다', () => {
    const rendered = formatStudyBrief({
      topic: 'context7',
      verdict: {
        kind: 'TOOL',
        whatImproves: '문서 검색 개선',
        adoptionCost: '낮음',
        minutes: 10,
      },
      reportMd: '조사 전문',
    });

    expect(rendered.summary).toBe(
      [
        '🔧 *오늘의 도구 — context7*   ·  설치 10분',
        '',
        '*뭐가 좋아지나* 문서 검색 개선',
        '*붙이는 비용* 낮음',
      ].join('\n'),
    );
    expect(rendered.summary).not.toContain('*설치*');
    expect(rendered.summary).not.toContain('*주의*');
  });

  it('LLM 출력의 mrkdwn control char를 escape한다', () => {
    const rendered = formatStudyBrief({
      topic: 'x*y_z~q<r>&`s`',
      verdict: {
        kind: 'TOOL',
        whatImproves: '*bold* & <tag>',
        adoptionCost: '_cost_',
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
        minutes: 1,
      },
      reportMd: 'a'.repeat(4000),
    });

    expect(rendered.full.length).toBeLessThanOrEqual(3000);
    expect(rendered.truncated).toBe(true);
  });
});
