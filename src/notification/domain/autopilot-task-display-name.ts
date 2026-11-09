import { AUTOPILOT_TASK_CRON_NAME_PREFIX } from './notification.type';

// `Autopilot task <taskId>` 형태의 cron 이름을 사람이 읽는 이름표로 바꾼다. 그 형태가 아니면 null.
// 이름표가 없는 task 는 id 를 그대로 둔다 — 숨기는 것보다 어색한 편이 낫고, 서로 다른 장애가
// 한 이름으로 합쳐지지 않는다. 장애 알림과 아침·저녁 장애 줄이 같은 표를 쓴다.
export const toAutopilotTaskDisplayName = (cronName: string): string | null => {
  if (!cronName.startsWith(AUTOPILOT_TASK_CRON_NAME_PREFIX)) {
    return null;
  }
  const taskId = cronName.slice(AUTOPILOT_TASK_CRON_NAME_PREFIX.length).trim();
  return AUTOPILOT_TASK_DISPLAY_NAME[taskId] ?? taskId;
};

// 장애 원장 label 을 아침·저녁 장애 줄 이름으로 바꾼다. label 은 작업 이름이다 — 예전 행은 cronName
// (`Autopilot task <taskId>`), 이름표가 없던 task 는 id 만, 새 행은 이름표다. 사건이 열려 있는 동안
// label 은 갱신되지 않는다(실측: `instagram-token-check`, 2026-11-06). 저녁 「그 밖에」처럼 장애 칸
// 제목이 없는 자리에서도 장애로 읽히게 「실패」를 붙인다.
export const toIncidentLabel = (label: string): string => {
  const name =
    toAutopilotTaskDisplayName(label) ??
    AUTOPILOT_TASK_DISPLAY_NAME[label] ??
    label;
  return name.endsWith(' 실패') ? name : `${name} 실패`;
};

// "해결 — 블로그 GitHub 발행 실패" 처럼 읽히지 않게 해결 줄에서는 " 실패" 를 뗀다.
export const toResolvedLabel = (label: string): string =>
  toIncidentLabel(label).replace(/ 실패$/, '');

const AUTOPILOT_TASK_DISPLAY_NAME: Partial<Record<string, string>> = {
  'blog-github-publish': '블로그 GitHub 발행',
  'portfolio-publish': '포트폴리오 발행',
  'portfolio-warmup': '포트폴리오 사이트 깨우기',
  'paper-trading': '모의투자 평가',
  'paper-recommend': '모의투자 추천',
  'paper-order-fill': '모의투자 체결',
  'paper-score': '모의투자 채점',
  'evening-retro-publish': '저녁 마감',
  'morning-briefing': '아침 브리핑',
  'po-shadow': 'PO 검토',
  secretariat: '비서실',
  'work-reviewer': '업무일지',
  'daily-eval': '하루 평가',
  'stock-monitor': '주식 모니터링',
  'stock-monitor-us': '미국 주식 모니터링',
  'job-feed': '공고 수집',
  'job-feed-gap': '공고 갭 분석',
  'study-applicability': '공부 적용 판정',
  'study-deepdive': '공부 딥다이브',
  'weekly-summary': '주간 요약',
  'impact-report': '임팩트 리포트',
  'cuj-check': 'CUJ 점검',
  'ai-cli-env-apply': 'AI 도구 설정 적용',
  'ai-cli-env-snapshot': 'AI 도구 설정 백업',
  'blog-revision-report': '블로그 수정률 보고',
  'docs-sync-audit': '문서·코드 맞춤 점검',
  'goal-checkin': '목표 점검',
  'holiday-sync': '공휴일 동기화',
  'humanize-research': '윤문 연구',
  'idea-triage': '아이디어 분류',
  'instagram-token-check': '인스타그램 토큰 점검',
  'knowledge-lint': '기억 점검',
  'memory-vacuum': '세션 기억 정리',
  'ops-supervisor': '운영 감독',
  'paper-intraday-stop': '모의투자 장중 손절',
  'pr-review-sweep': 'PR 리뷰 점검',
  'preference-learning': '선호 학습',
  'preview-sweeper': '만료 승인 카드 정리',
  'reels-insights-collect': '릴스 인사이트 수집',
  'reels-insights-weekly': '릴스 주간 리포트',
  'reels-format-decide': '릴스 형식 판정',
  'reels-publish-offer': '릴스 게시 제안',
  'run-retro': '주간 실행 회고',
  'run-sweeper': '멈춘 실행 정리',
  'schedule-collect-github': 'GitHub 업무 수집',
  'schedule-collect-notion': 'Notion 업무 수집',
  'schedule-collect-slack': 'Slack 업무 수집',
  'schedule-reminder': '일정 알림',
  'screening-outcome-scoring': '종목 선별 채점',
  'screening-scorecard': '종목 선별 성적 카드',
  'stock-alert-scoring': '주식 알림 채점',
  'universe-sweep': '종목 시세 수집',
};
