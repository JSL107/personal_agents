import { AUTOPILOT_TASK_CRON_NAME_PREFIX } from './notification.type';

// `Autopilot task <taskId>` 형태의 cron 이름을 사람이 읽는 이름표로 바꾼다. 그 형태가 아니면 null.
// 이름표가 없는 task 는 id 를 그대로 둔다 — 숨기는 것보다 어색한 편이 낫고, 서로 다른 장애가
// 한 이름으로 합쳐지지 않는다. 장애 알림과 아침 장애 줄이 같은 표를 쓴다.
export const toAutopilotTaskDisplayName = (cronName: string): string | null => {
  if (!cronName.startsWith(AUTOPILOT_TASK_CRON_NAME_PREFIX)) {
    return null;
  }
  const taskId = cronName.slice(AUTOPILOT_TASK_CRON_NAME_PREFIX.length).trim();
  return AUTOPILOT_TASK_DISPLAY_NAME[taskId] ?? taskId;
};

const AUTOPILOT_TASK_DISPLAY_NAME: Partial<Record<string, string>> = {
  'blog-github-publish': '블로그 GitHub 발행',
  'portfolio-publish': '포트폴리오 발행',
  'portfolio-warmup': '포트폴리오 사이트 깨우기',
  'paper-trading': '모의투자',
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
};
