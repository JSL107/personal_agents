import { PullRequestReview } from '../agent/code-reviewer/domain/code-reviewer.type';
import { ContextSummary } from '../agent/pm/application/sync-context.usecase';
import { DailyPlan, TaskItem } from '../agent/pm/domain/pm-agent.type';
import { DailyReview } from '../agent/work-reviewer/domain/work-reviewer.type';
import { QuotaStatsResult } from '../agent-run/application/get-quota-stats.usecase';
import {
  formatContextSummary,
  formatDailyPlan,
  formatDailyReview,
  formatModelFooter,
  formatPullRequestReview,
  formatQuotaStats,
} from './slack.service';

const task = (title: string, overrides: Partial<TaskItem> = {}): TaskItem => ({
  id: overrides.id ?? `user:${title}`,
  title,
  source: overrides.source ?? 'USER_INPUT',
  subtasks: overrides.subtasks ?? [],
  isCriticalPath: overrides.isCriticalPath ?? false,
  ...(overrides.lineage !== undefined ? { lineage: overrides.lineage } : {}),
  ...(overrides.url !== undefined ? { url: overrides.url } : {}),
});

describe('formatDailyPlan', () => {
  const base: DailyPlan = {
    topPriority: task('PM Agent 구현 마무리', { isCriticalPath: true }),
    varianceAnalysis: {
      rolledOverTasks: [],
      analysisReasoning: '(이월 없음)',
    },
    morning: [task('크롤러 테스트'), task('prisma schema 검토')],
    afternoon: [task('README 보강'), task('코드 리뷰 2건')],
    blocker: null,
    estimatedHours: 7,
    reasoning: 'impact 기준으로 PM Agent 를 오전 최우선으로 배치',
  };

  it('blocker 가 null 이면 Blocker 라인을 출력하지 않는다', () => {
    const output = formatDailyPlan(base);

    expect(output).toContain('*오늘의 최우선 과제*');
    expect(output).toContain('PM Agent 구현 마무리');
    expect(output).toContain('⚠');
    expect(output).toContain('*오전*');
    expect(output).toContain('• 크롤러 테스트');
    expect(output).toContain('*오후*');
    expect(output).toContain('• README 보강');
    expect(output).toContain('*예상 소요*: 7시간');
    expect(output).toContain('*판단 근거*: impact 기준으로');
    expect(output).not.toContain('*Blocker*');
  });

  it('blocker 가 문자열이면 Blocker 라인을 추가한다', () => {
    const output = formatDailyPlan({
      ...base,
      blocker: '디자인팀 시안 대기',
    });

    expect(output).toContain('*Blocker*: 디자인팀 시안 대기');
  });

  it('morning / afternoon 항목 전체가 bullet 으로 출력된다', () => {
    const output = formatDailyPlan(base);
    const bulletLines = output
      .split('\n')
      .filter((line) => line.startsWith('• '));

    expect(bulletLines).toHaveLength(
      1 + base.morning.length + base.afternoon.length,
    );
  });

  it('morning 배열이 비어 있으면 *오전* 헤더만 남고 bullet 이 없다', () => {
    const output = formatDailyPlan({ ...base, morning: [] });

    const morningSection = output
      .split('\n\n')
      .find((block) => block.startsWith('*오전*'));

    expect(morningSection).toBe('*오전*');
  });
});

describe('formatDailyReview', () => {
  const base: DailyReview = {
    summary: 'PM Agent / Work Reviewer 구현',
    impact: {
      quantitative: ['unit test +12건', 'CLI 격리 범위 +3항목'],
      qualitative: 'prompt-injection 리스크 제거',
    },
    improvementBeforeAfter: {
      before: 'codex 가 parent env/HOME 상속',
      after: 'throwaway HOME + stdin prompt 로 격리',
    },
    nextActions: ['/review-pr 설계', 'Phase 2b GitHub 커넥터 착수'],
    oneLineAchievement: 'codex 어댑터 격리로 secret 유출 경로 차단',
  };

  it('모든 섹션(요약/정량/질적/개선/다음/성과) 을 순서대로 출력한다', () => {
    const output = formatDailyReview(base);

    expect(output).toContain('*오늘 한 일*');
    expect(output).toContain('PM Agent / Work Reviewer 구현');
    expect(output).toContain('*정량 근거*');
    expect(output).toContain('• unit test +12건');
    expect(output).toContain('*질적 영향*');
    expect(output).toContain('*개선 전/후*');
    expect(output).toContain('• Before: codex 가 parent env/HOME 상속');
    expect(output).toContain('• After: throwaway HOME + stdin prompt 로 격리');
    expect(output).toContain('*다음 액션*');
    expect(output).toContain('• /review-pr 설계');
    expect(output).toContain(
      '*한 줄 성과*: codex 어댑터 격리로 secret 유출 경로 차단',
    );
  });

  it('improvementBeforeAfter 가 null 이면 개선 전/후 섹션이 생략된다', () => {
    const output = formatDailyReview({ ...base, improvementBeforeAfter: null });
    expect(output).not.toContain('*개선 전/후*');
  });

  it('impact.quantitative 가 비어있으면 정량 근거 섹션이 생략된다 (근거 부족 케이스)', () => {
    const output = formatDailyReview({
      ...base,
      impact: {
        quantitative: [],
        qualitative: '정량 근거 부족으로 임팩트는 추정 수준',
      },
    });
    expect(output).not.toContain('*정량 근거*');
    expect(output).toContain('*질적 영향*');
    expect(output).toContain('정량 근거 부족으로 임팩트는 추정 수준');
  });

  it('nextActions 가 비어있으면 다음 액션 섹션이 생략된다', () => {
    const output = formatDailyReview({ ...base, nextActions: [] });
    expect(output).not.toContain('*다음 액션*');
  });
});

describe('formatPullRequestReview', () => {
  const base: PullRequestReview = {
    summary: 'GitHub 커넥터 추가',
    riskLevel: 'medium',
    mustFix: ['에러 마스킹 필요'],
    niceToHave: ['주석 보강'],
    missingTests: ['paginate truncated 케이스'],
    reviewCommentDrafts: [
      { file: 'src/x.ts', line: 10, body: '여기 위험' },
      { body: '전반적으로 OK' },
    ],
    approvalRecommendation: 'request_changes',
  };

  it('PR ref / 위험도 / 권고 / 모든 섹션 출력', () => {
    const output = formatPullRequestReview({
      prRef: 'foo/bar#34',
      review: base,
    });

    expect(output).toContain('*PR 리뷰 — foo/bar#34*');
    expect(output).toContain('🟡 MEDIUM');
    expect(output).toContain('✋ Request changes');
    expect(output).toContain('*Must-Fix*');
    expect(output).toContain('• 에러 마스킹 필요');
    expect(output).toContain('*Nice-to-have*');
    expect(output).toContain('*누락 테스트*');
    expect(output).toContain('*리뷰 코멘트 초안*');
    expect(output).toContain('• `src/x.ts:10` 여기 위험');
    expect(output).toContain('• 전반적으로 OK');
  });

  it('빈 섹션은 헤더 자체를 생략', () => {
    const output = formatPullRequestReview({
      prRef: 'foo/bar#1',
      review: {
        ...base,
        mustFix: [],
        niceToHave: [],
        missingTests: [],
        reviewCommentDrafts: [],
      },
    });

    expect(output).not.toContain('*Must-Fix*');
    expect(output).not.toContain('*Nice-to-have*');
    expect(output).not.toContain('*누락 테스트*');
    expect(output).not.toContain('*리뷰 코멘트 초안*');
  });

  it('riskLevel low + approve 라벨 매핑', () => {
    const output = formatPullRequestReview({
      prRef: 'a/b#1',
      review: { ...base, riskLevel: 'low', approvalRecommendation: 'approve' },
    });
    expect(output).toContain('🟢 LOW');
    expect(output).toContain('✅ Approve');
  });

  it('reviewCommentDrafts 의 file/line 누락 시 location prefix 생략', () => {
    const output = formatPullRequestReview({
      prRef: 'a/b#1',
      review: {
        ...base,
        reviewCommentDrafts: [{ body: '단순 코멘트' }],
      },
    });
    expect(output).toContain('• 단순 코멘트');
    expect(output).not.toContain('``');
  });
});

describe('formatModelFooter', () => {
  it('AgentRunOutcome 의 modelUsed 와 agentRunId 를 한 줄 footer 로 렌더', () => {
    const footer = formatModelFooter({
      result: {},
      modelUsed: 'codex-cli',
      agentRunId: 42,
    });

    expect(footer).toBe('\n\n_model: codex-cli · run #42_');
  });

  it('result 타입과 무관하게 동작 — generic 푸터', () => {
    const footer = formatModelFooter({
      result: { plan: 'whatever' },
      modelUsed: 'claude-cli',
      agentRunId: 7,
    });

    expect(footer).toContain('claude-cli');
    expect(footer).toContain('run #7');
  });
});

describe('formatDailyPlan — lineage 라벨 (PRO-2)', () => {
  const planWithLineage: DailyPlan = {
    topPriority: task('이메일 지연 모니터링', {
      isCriticalPath: true,
      lineage: 'POSTPONED',
    }),
    varianceAnalysis: {
      rolledOverTasks: [],
      analysisReasoning: '(이월 없음)',
    },
    morning: [
      task('코드 리팩토링', { lineage: 'CARRIED' }),
      task('PRD 검토', { lineage: 'NEW' }),
    ],
    afternoon: [task('PR 리뷰', { lineage: 'NEW' })],
    blocker: null,
    estimatedHours: 5,
    reasoning: 'r',
  };

  it('NEW / CARRIED / POSTPONED 라벨이 각 task 앞에 prefix 로 붙는다', () => {
    const output = formatDailyPlan(planWithLineage);
    expect(output).toContain('🆕');
    expect(output).toContain('🔁');
    expect(output).toContain('⏭');
  });

  it('lineage 가 없는 구버전 task 는 prefix 없이 렌더 (backward compat)', () => {
    const legacyPlan: DailyPlan = {
      ...planWithLineage,
      topPriority: task('lineage 없는 구버전 plan', { isCriticalPath: true }),
      morning: [task('legacy morning')],
      afternoon: [task('legacy afternoon')],
    };
    const output = formatDailyPlan(legacyPlan);
    expect(output).not.toContain('🆕');
    expect(output).not.toContain('🔁');
    expect(output).not.toContain('⏭');
    expect(output).toContain('legacy morning');
  });
});

describe('formatDailyPlan — url 링크 (PRO-2+ 이슈 A)', () => {
  it('task 에 url 이 있으면 Slack 마크다운 링크로 렌더', () => {
    const plan: DailyPlan = {
      topPriority: task('PR #707 리뷰', {
        url: 'https://github.com/foo/bar/pull/707',
      }),
      varianceAnalysis: {
        rolledOverTasks: [],
        analysisReasoning: '(이월 없음)',
      },
      morning: [],
      afternoon: [],
      blocker: null,
      estimatedHours: 1,
      reasoning: 'r',
    };
    const output = formatDailyPlan(plan);
    expect(output).toContain(
      '<https://github.com/foo/bar/pull/707|PR #707 리뷰>',
    );
  });

  it('url 이 없거나 빈 문자열이면 단순 텍스트로 렌더', () => {
    const plan: DailyPlan = {
      topPriority: task('자유 텍스트 task'),
      varianceAnalysis: {
        rolledOverTasks: [],
        analysisReasoning: '(이월 없음)',
      },
      morning: [task('빈 url', { url: '' })],
      afternoon: [],
      blocker: null,
      estimatedHours: 1,
      reasoning: 'r',
    };
    const output = formatDailyPlan(plan);
    expect(output).toContain('• 자유 텍스트 task');
    expect(output).toContain('• 빈 url');
    expect(output).not.toContain('<|');
  });

  it('url 이 http(s) 가 아니면 broken link 회피 — 단순 텍스트로 fallback (codex P0 fix)', () => {
    const plan: DailyPlan = {
      topPriority: task('fragment 만 반환', { url: '/pull/707' }),
      varianceAnalysis: {
        rolledOverTasks: [],
        analysisReasoning: '(이월 없음)',
      },
      morning: [task('javascript 스킴 차단', { url: 'javascript:alert(1)' })],
      afternoon: [],
      blocker: null,
      estimatedHours: 1,
      reasoning: 'r',
    };
    const output = formatDailyPlan(plan);
    expect(output).not.toContain('</pull/707|');
    expect(output).not.toContain('<javascript:');
    expect(output).toContain('• fragment 만 반환');
    expect(output).toContain('• javascript 스킴 차단');
  });

  it('title/url 에 Slack mrkdwn 특수문자 (`<>|`) 가 섞여도 sanitize 후 링크 (omc P2 fix)', () => {
    const plan: DailyPlan = {
      topPriority: task('악성<title>|injection', {
        url: 'https://example.com/path?q=<bad>|trick',
      }),
      varianceAnalysis: {
        rolledOverTasks: [],
        analysisReasoning: '(이월 없음)',
      },
      morning: [],
      afternoon: [],
      blocker: null,
      estimatedHours: 1,
      reasoning: 'r',
    };
    const output = formatDailyPlan(plan);
    const linkMatch = output.match(/<https:\/\/example\.com[^>]+\|[^>]+>/);
    expect(linkMatch).not.toBeNull();
    expect(linkMatch?.[0]).not.toContain('<bad>');
    expect(linkMatch?.[0]).not.toContain('악성<title>');
  });
});

describe('formatModelFooter — sanitize (codex P1 / omc P2 fix)', () => {
  it('modelUsed 에 mrkdwn 특수문자가 섞여도 footer 가 안 깨짐', () => {
    const footer = formatModelFooter({
      result: {},
      modelUsed: 'evil<model>|name',
      agentRunId: 7,
    });
    expect(footer).not.toContain('<model>');
    expect(footer).not.toContain('|name');
    expect(footer).toContain('evilmodelname');
    expect(footer).toContain('run #7');
  });
});

describe('formatContextSummary (HOTFIX-1)', () => {
  const summary: ContextSummary = {
    github: { fetchSucceeded: true, issueCount: 3, pullRequestCount: 1 },
    notion: { taskCount: 2 },
    slack: { mentionCount: 5, sinceHours: 24 },
    previousPlan: { agentRunId: 99, endedAt: '2026-04-26T05:00:00.000Z' },
    previousWorklog: { agentRunId: 100, endedAt: '2026-04-26T08:00:00.000Z' },
  };

  it('전 섹션 (GitHub/Notion/Slack/PM/Work Reviewer) 을 한국어 마크다운으로 출력', () => {
    const output = formatContextSummary(summary);
    expect(output).toContain('*컨텍스트 재수집 결과*');
    expect(output).toContain('Issue 3건 / PR 1건');
    expect(output).toContain('활성 task 2건');
    expect(output).toContain('본인 멘션 5건');
    expect(output).toContain('직전 PM 실행*: #99 (2026-04-26)');
    expect(output).toContain('직전 Work Reviewer 실행*: #100 (2026-04-26)');
  });

  it('GitHub fetch 실패 시 ⚠ 라인 노출 + Notion/Slack 은 그대로', () => {
    const output = formatContextSummary({
      ...summary,
      github: { fetchSucceeded: false, issueCount: 0, pullRequestCount: 0 },
    });
    expect(output).toContain('⚠ 수집 실패');
    expect(output).toContain('활성 task 2건');
  });

  it('직전 plan/worklog 없으면 "없음" 라인 노출', () => {
    const output = formatContextSummary({
      ...summary,
      previousPlan: null,
      previousWorklog: null,
    });
    expect(output).toContain('직전 PM 실행*: 없음');
    expect(output).toContain('직전 Work Reviewer 실행*: 없음');
  });
});

describe('formatDailyPlan — 참조 소스 섹션', () => {
  const plan: DailyPlan = {
    topPriority: task('최우선'),
    varianceAnalysis: {
      rolledOverTasks: [],
      analysisReasoning: '(이월 없음)',
    },
    morning: [task('오전 1')],
    afternoon: [task('오후 1')],
    blocker: null,
    estimatedHours: 5,
    reasoning: 'r',
  };

  it('sources 가 비어있으면 참조 소스 섹션 생략', () => {
    const output = formatDailyPlan(plan, []);
    expect(output).not.toContain('*참조 소스*');
  });

  it('sources 가 있으면 맨 위에 섹션 + URL 있는 항목은 링크 표기', () => {
    const output = formatDailyPlan(plan, [
      {
        type: 'github_issue',
        label: 'foo/bar#12 — 크롤러 버그',
        url: 'https://github.com/foo/bar/issues/12',
      },
      { type: 'notion_task', label: '결제 API 리팩터링' },
      {
        type: 'previous_plan',
        label: '직전 PM 실행 #99 (2026-04-23)',
      },
    ]);
    expect(output).toContain('*참조 소스*');
    expect(output).toContain(
      '• foo/bar#12 — 크롤러 버그 (<https://github.com/foo/bar/issues/12|링크>)',
    );
    expect(output).toContain('• 결제 API 리팩터링');
    expect(output).not.toContain('결제 API 리팩터링 (<');
    expect(output).toContain('• 직전 PM 실행 #99 (2026-04-23)');

    // 맨 위에 오는지 — *오늘의 최우선* 앞에 위치
    const sourcesIdx = output.indexOf('*참조 소스*');
    const topPriorityIdx = output.indexOf('*오늘의 최우선');
    expect(sourcesIdx).toBeLessThan(topPriorityIdx);
  });
});

describe('formatQuotaStats (OPS-1)', () => {
  it('rows 가 비어있으면 "기록 없음" 안내 문구', () => {
    const result: QuotaStatsResult = {
      range: 'TODAY',
      sinceIso: '2026-04-26T12:00:00.000Z',
      rows: [],
      totals: { count: 0, totalDurationMs: 0 },
    };
    const output = formatQuotaStats(result);
    expect(output).toContain('오늘 (24시간)');
    expect(output).toContain('기록 없음');
  });

  it('provider 별 count 내림차순으로 출력 + 합계 라인', () => {
    const result: QuotaStatsResult = {
      range: 'WEEK',
      sinceIso: '2026-04-20T12:00:00.000Z',
      rows: [
        {
          cliProvider: 'claude-cli',
          count: 3,
          avgDurationMs: 20_000,
          totalDurationMs: 60_000,
        },
        {
          cliProvider: 'codex-cli',
          count: 5,
          avgDurationMs: 12_000,
          totalDurationMs: 60_000,
        },
      ],
      totals: { count: 8, totalDurationMs: 120_000 },
    };
    const output = formatQuotaStats(result);

    expect(output).toContain('최근 7일');
    expect(output).toContain('codex-cli — 5회');
    expect(output).toContain('claude-cli — 3회');
    // codex-cli (5회) 가 claude-cli (3회) 보다 위에 있어야 함
    expect(output.indexOf('codex-cli')).toBeLessThan(
      output.indexOf('claude-cli'),
    );
    expect(output).toContain('*합계*: 8회');
    // 120_000 ms = 2.0분
    expect(output).toContain('총 2.0분');
  });
});
