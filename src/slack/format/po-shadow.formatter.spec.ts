import { PoShadowReport } from '../../agent/po-shadow/domain/po-shadow.type';
import {
  formatPoShadowDetail,
  formatPoShadowReport,
} from './po-shadow.formatter';

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

    expect(sections[0]).toBe('*PO 검토 — 계획과 다른 점 1가지*');
    expect(sections[1]).toBe('🎯 *먼저* #264 업로드 차단부터 해소한다.');
    expect(sections[2]).toBe(
      '1. #264 업로드가 멈췄다\n      → 리뷰어를 지정한다\n      근거: #264 업로드 차단 · 리뷰 0건',
    );
  });

  it('detailInThread 면 근거 줄과 지난 지적 통계를 빼고 formatPoShadowDetail 이 싣는다', () => {
    const report = {
      ...base,
      recoverySummary: {
        merged: 3,
        unresolved: 1,
        unmovedFactCount: 1,
        abandoned: 0,
        unassigned: 0,
        uncomparable: 0,
        total: 4,
      },
    };

    const main = formatPoShadowReport(report, { detailInThread: true });
    expect(main).toContain(
      '1. #264 업로드가 멈췄다\n      → 리뷰어를 지정한다',
    );
    expect(main).not.toContain('근거:');
    expect(main).not.toContain('지난 지적');

    const detail = formatPoShadowDetail(report);
    expect(detail).toContain('*지적별 근거*\n1. #264 업로드 차단 · 리뷰 0건');
    expect(detail).toContain('🔁 *지난 지적 4건*');
  });

  it('findingReferences 가 있으면 지적 아래 저장소·제목 링크를 단다 — 링크 텍스트의 Slack 문법은 막는다', () => {
    const rendered = formatPoShadowReport(
      {
        ...base,
        findingReferences: [
          [
            {
              text: 'sbe-conduct-api#3922 학교 관리자용',
              url: 'https://github.com/o/r/pull/3922',
            },
            { text: '<!channel> 워커', url: null },
          ],
        ],
      },
      { detailInThread: true },
    );
    expect(rendered).toContain(
      '1. #264 업로드가 멈췄다\n      • <https://github.com/o/r/pull/3922|sbe-conduct-api#3922 학교 관리자용>\n      • &lt;!channel&gt; 워커\n      → 리뷰어를 지정한다',
    );
  });

  it('링크가 있는 참조도 라벨의 Slack 제어문자(<>|)를 걷어 링크 태그를 깨지 못하게 한다', () => {
    const rendered = formatPoShadowReport(
      {
        ...base,
        findingReferences: [
          [
            {
              text: 'app#1 <!channel>|가짜',
              url: 'https://github.com/o/r/pull/1',
            },
          ],
        ],
      },
      { detailInThread: true },
    );
    expect(rendered).toContain(
      '      • <https://github.com/o/r/pull/1|app#1 !channel가짜>',
    );
    expect(rendered).not.toContain('<!channel>');
  });

  it('formatPoShadowDetail 은 quiet 회차에 null 이다', () => {
    expect(formatPoShadowDetail({ ...base, quiet: true })).toBeNull();
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

    expect(rendered).toContain(
      '2. 코드 리뷰가 실패했다\n      → 실패 원인을 확인한다',
    );
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
      '🎯 *먼저* #264 업로드 차단부터 해소한다.\n\n근거: #264 리뷰 0건\n근거: #975 새 담당 PR',
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

describe('formatPoShadowReport — 묵은 목표 질문', () => {
  const checkIns = [
    '"업로드 개선" — 30일 넘게 붙은 진행 없음. 이 목표 아직 유효한가요?',
  ];

  it.each([
    ['조용한 날', { ...base, quiet: true, findings: [], factSummary: [] }],
    ['검토하는 날', base],
  ])('%s에도 목표 점검 블록을 싣는다', (_, report) => {
    const text = formatPoShadowReport({ ...report, goalCheckIns: checkIns });
    expect(text).toContain('🧭 *목표 점검*');
    expect(text).toContain('이 목표 아직 유효한가요?');
    expect(text).toContain('목표 닫아줘');
  });

  it('질문이 없으면 카드가 목표 도입 전과 같다', () => {
    expect(formatPoShadowReport({ ...base, goalCheckIns: [] })).toBe(
      formatPoShadowReport(base),
    );
  });
});
