import { PoShadowReport } from '../../agent/po-shadow/domain/po-shadow.type';
import { formatPoShadowReport } from './po-shadow.formatter';

const base: PoShadowReport = {
  schemaVersion: 2,
  quiet: false,
  headline: '#264 업로드 차단부터 해소한다.',
  findings: [
    {
      factIds: ['stalled:acme/app#264'],
      point: '#264 업로드가 멈췄다',
      suggestion: '리뷰어를 지정한다',
    },
  ],
  judgments: ['성과 정리보다 업로드 차단 해소가 먼저다.'],
  recoverySummary: null,
  factSummary: ['#264 업로드 차단 · 리뷰 0건'],
  droppedFindingCount: 1,
  degradedSources: [],
};

describe('formatPoShadowReport — 조회 실패 표시', () => {
  it('조용한 날에도 못 본 소스를 밝힌다', () => {
    const rendered = formatPoShadowReport({
      ...base,
      quiet: true,
      headline: '계획대로 진행 중',
      findings: [],
      judgments: [],
      recoverySummary: null,
      factSummary: [],
      droppedFindingCount: 0,
      degradedSources: ['GitHub 담당 목록'],
    });

    expect(rendered).toContain('계획대로 진행 중');
    expect(rendered).toContain('GitHub 담당 목록 조회 실패');
  });

  it('지적이 있는 날에도 못 본 소스를 밝힌다', () => {
    const rendered = formatPoShadowReport({
      ...base,
      degradedSources: ['Slack 멘션', 'Notion 태스크'],
    });

    expect(rendered).toContain('Slack 멘션 · Notion 태스크 조회 실패');
  });

  it('모든 소스를 봤으면 경고 줄을 넣지 않는다', () => {
    expect(formatPoShadowReport(base)).not.toContain('조회 실패');
  });
});

describe('formatPoShadowReport', () => {
  it('quiet 결과는 사실 요약을 붙인 한 줄로 렌더한다', () => {
    const rendered = formatPoShadowReport({
      ...base,
      quiet: true,
      headline: '계획대로 진행 중',
      findings: [],
      judgments: [],
      recoverySummary: null,
      factSummary: ['#10 머지 완료', '사용자 입력 일정 확인 불가'],
      droppedFindingCount: 0,
      degradedSources: [],
    });

    expect(rendered).toBe(
      '✅ *PO 검토* — 계획대로 진행 중 (#10 머지 완료 · 사용자 입력 일정 확인 불가)',
    );
  });

  it('quiet 결과에 사실 요약이 없으면 빈 괄호를 남기지 않는다', () => {
    const rendered = formatPoShadowReport({
      ...base,
      quiet: true,
      headline: '계획대로 진행 중',
      findings: [],
      judgments: [],
      recoverySummary: null,
      factSummary: [],
      droppedFindingCount: 0,
      degradedSources: [],
    });

    expect(rendered).toBe('✅ *PO 검토* — 계획대로 진행 중');
  });

  it('non-quiet 결과는 결론 뒤에 지적과 같은 인덱스의 근거를 렌더한다', () => {
    const rendered = formatPoShadowReport(base);
    const sections = rendered.split('\n\n');

    expect(sections[0]).toBe('*PO 검토*');
    expect(sections[1]).toBe(
      '🎯 *먼저 이것부터* #264 업로드 차단부터 해소한다.',
    );
    expect(sections[2]).toBe(
      '• #264 업로드가 멈췄다 — 리뷰어를 지정한다\n  ↳ 근거: #264 업로드 차단 · 리뷰 0건',
    );
  });

  it('finding보다 factSummary가 짧으면 누락 근거 줄만 생략한다', () => {
    const rendered = formatPoShadowReport({
      ...base,
      findings: [
        base.findings[0],
        {
          factIds: ['failed:CODE_REVIEWER'],
          point: '코드 리뷰가 실패했다',
          suggestion: '실패 원인을 확인한다',
        },
      ],
    });

    expect(rendered).toContain('• 코드 리뷰가 실패했다 — 실패 원인을 확인한다');
    expect(rendered).not.toContain('근거: undefined');
    expect(rendered).not.toContain('undefined');
  });

  it('모든 finding이 폐기됐으면 headline 뒤에 모든 사실 요약을 근거로 렌더한다', () => {
    const rendered = formatPoShadowReport({
      ...base,
      findings: [],
      factSummary: ['#264 리뷰 0건', '#975 새 담당 PR'],
    });

    expect(rendered).toContain(
      '🎯 *먼저 이것부터* #264 업로드 차단부터 해소한다.\n\n  ↳ 근거: #264 리뷰 0건\n  ↳ 근거: #975 새 담당 PR',
    );
  });

  it('judgments는 추정 접두를 달아 렌더한다 — 근거 없음을 실토한다', () => {
    const rendered = formatPoShadowReport(base);
    expect(rendered).toContain(
      '🤔 _추정_ 성과 정리보다 업로드 차단 해소가 먼저다.',
    );
  });

  it('judgments가 비면 그 블록이 없다', () => {
    const rendered = formatPoShadowReport({ ...base, judgments: [] });
    expect(rendered).not.toContain('_추정_');
  });

  it('droppedFindingCount는 0보다 클 때만 렌더한다', () => {
    const withDropped = formatPoShadowReport(base);
    const withoutDropped = formatPoShadowReport({
      ...base,
      droppedFindingCount: 0,
      degradedSources: [],
    });

    expect(withDropped).toContain('_근거 없는 지적 1건은 제외했습니다._');
    expect(withoutDropped).not.toContain('근거 없는 지적');
  });

  it('headline·finding·judgments·factSummary의 Slack 제어문자를 모두 escape한다', () => {
    const rendered = formatPoShadowReport({
      ...base,
      headline: '<headline> & now',
      findings: [
        {
          factIds: ['fact:1'],
          point: '<point> & risk',
          suggestion: '<suggestion> & act',
        },
      ],
      judgments: ['<purpose> & conflict'],
      recoverySummary: null,
      factSummary: ['<fact> & evidence'],
    });

    expect(rendered).toContain('&lt;headline&gt; &amp; now');
    expect(rendered).toContain('&lt;point&gt; &amp; risk');
    expect(rendered).toContain('&lt;suggestion&gt; &amp; act');
    expect(rendered).toContain('&lt;purpose&gt; &amp; conflict');
    expect(rendered).toContain('&lt;fact&gt; &amp; evidence');
    expect(rendered).not.toContain('<headline>');
  });

  it('quiet 사실 요약도 Slack 제어문자를 escape한다', () => {
    const rendered = formatPoShadowReport({
      ...base,
      quiet: true,
      findings: [],
      judgments: [],
      recoverySummary: null,
      factSummary: ['<fact> & evidence'],
      droppedFindingCount: 0,
      degradedSources: [],
    });

    expect(rendered).toBe(
      '✅ *PO 검토* — 계획대로 진행 중 (&lt;fact&gt; &amp; evidence)',
    );
  });
});

describe('회수 블록 — factSummary 가 아니라 독립 블록으로 낸다', () => {
  const summary = {
    merged: 5,
    unresolved: 6,
    unmovedFactCount: 4,
    abandoned: 2,
    unassigned: 1,
    uncomparable: 3,
    total: 15,
  };

  it('quiet 회차에도 렌더된다 — 모델이 인용하지 않아도 사라지지 않는다', () => {
    const rendered = formatPoShadowReport({
      ...base,
      quiet: true,
      recoverySummary: summary,
    });
    expect(rendered).toContain('🔁 *지난 지적 12건* (대조 불가 3건)');
    expect(rendered).toContain('머지 5');
    expect(rendered).toContain('머지 없이 닫힘 2');
    expect(rendered).toContain('담당에서 빠짐 1');
  });

  it('미해결에 섞인 7일 미만 건수를 밝힌다 — 숫자와 근거 줄이 어긋나 보이는 것을 막는다', () => {
    const rendered = formatPoShadowReport({
      ...base,
      quiet: true,
      recoverySummary: summary,
    });
    expect(rendered).toContain('미해결 6 (그중 2건은 지적 7일 미만)');
  });

  it('대조군이 없다는 것을 병기한다 — 맨 숫자를 비율처럼 읽지 않게', () => {
    const rendered = formatPoShadowReport({
      ...base,
      quiet: true,
      recoverySummary: summary,
    });
    expect(rendered).toContain('비교 대상 없음');
  });

  it('회수할 지적이 없던 회차에는 블록 자체가 없다', () => {
    const rendered = formatPoShadowReport({
      ...base,
      quiet: true,
      recoverySummary: null,
    });
    expect(rendered).not.toContain('🔁');
  });
});
