import {
  ART_JOB_EXCLUDE_LABEL,
  ART_JOB_INTEREST_LABEL,
  ART_JOB_RESTORE_LABEL,
  ART_JOB_UNINTEREST_LABEL,
} from '../../art-job-feed/domain/art-job-exclusion';

// 말로 시키지 않아도 이대리가 하는 일(정해진 시간 발송)과 이모지로 할 수 있는 일.
//
// WORKER_CAPABILITIES 는 자연어로 실행되는 워커만 담아서, 대화 답변이 이쪽 기능을 몰랐다.
// "공고중에서 필요하지 않은 공고를 제외하는 방법 알려줘." 에 공고 제외 기능이 있는데도
// "직접 선별·제외는 못 한다" 고 답했다(2026-10-14 run 8787).
//
// 문구는 기능 쪽 안내와 따로 적혀 있다 — 기능의 조작법이 바뀌면 여기도 고친다
// (원화 공고 제외는 #804 에서 번호 이모지 → 「관심 없음」 버튼으로 바뀌었다). 버튼 문구처럼 기능 코드가
// 실제로 쓰는 값은 그 모듈 domain 의 상수를 가져다 써서, 조작법이 바뀌면 여기가 같이 바뀌거나 빌드가 깨지게 한다.
//
// isEnabled 가 false 면 그 기능은 꺼진 것이라 안내하지 않는다 — 켜는 조건은 각 기능의
// 등록 코드와 같다(art-job-exclusion-action.handler.ts, *-cron.scheduler.ts, autopilot.scheduler.ts,
// art-job-deadline-cron.scheduler.ts, append-pushpin-task.service.ts). 내부 정리·감사 작업과 운영 알림은 사용자가 할 일이 없어 싣지 않는다.
export type EnvReader = (key: string) => string | undefined;

export interface PassiveCapability {
  isEnabled: (read: EnvReader) => boolean;
  describe: (read: EnvReader) => string;
}

const has = (read: EnvReader, key: string): boolean =>
  Boolean(read(key)?.trim());

// 오토파일럿 task 들은 `=== 'true'` 일 때만 돈다(stock-monitor·paper-trading·job-feed task 의 run).
const isTrue = (read: EnvReader, key: string): boolean => read(key) === 'true';

const hasAll =
  (...keys: string[]) =>
  (read: EnvReader): boolean =>
    keys.every((key) => has(read, key));

// 오토파일럿 플레이북 전체가 이 값 없이는 등록되지 않는다(autopilot.scheduler.ts).
const autopilotAnd =
  (flag: string) =>
  (read: EnvReader): boolean =>
    has(read, 'AUTOPILOT_OWNER_SLACK_USER_ID') && isTrue(read, flag);

const emojiOf = (read: EnvReader, key: string, fallback: string): string =>
  `:${read(key)?.trim() || fallback}:`;

export const PASSIVE_CAPABILITIES: readonly PassiveCapability[] = [
  {
    isEnabled: hasAll('ART_JOB_FEED_TARGET'),
    describe: () =>
      '정해진 시간(기본 오전 9시·오후 6시)에 게임잡의 원화 채용공고를 이미지와 함께 채널에 올린다.',
  },
  {
    isEnabled: hasAll('ART_JOB_FEED_TARGET', 'ART_JOB_FEED_MENTION_USER_ID'),
    describe: () =>
      `원화 공고 글에서 빼고 싶은 공고 옆의 「${ART_JOB_EXCLUDE_LABEL}」 버튼을 누르면 같은 공고는 다음 회차부터 다시 보내지 않는다. 잘못 눌렀으면 「${ART_JOB_RESTORE_LABEL}」를 누르면 된다.`,
  },
  {
    // 버튼은 받는 사람이 있을 때만 달리고, 마감 전날 알림 cron 도 같은 값이 없으면 꺼진다
    // (art-job-deadline-cron.scheduler.ts).
    isEnabled: hasAll('ART_JOB_FEED_TARGET', 'ART_JOB_FEED_MENTION_USER_ID'),
    describe: () =>
      `원화 공고 글에서 마감일이 있는 공고 옆의 「${ART_JOB_INTEREST_LABEL}」 버튼을 누르면 마감 전날 DM 으로 알려 준다. 취소는 「${ART_JOB_UNINTEREST_LABEL}」.`,
  },
  {
    isEnabled: hasAll('SLACK_PUSHPIN_REACTION_NOTION_PAGE_ID'),
    describe: (read) =>
      `아무 메시지에나 ${emojiOf(read, 'SLACK_PUSHPIN_REACTION_EMOJI', 'pushpin')} 이모지를 달면 그 메시지를 Notion 할 일 페이지에 옮겨 적는다.`,
  },
  {
    isEnabled: () => true,
    describe: (read) =>
      `메시지에 ${emojiOf(read, 'SLACK_INBOX_EMOJI', 'raised_hand')} 이모지를 달면 할 일 후보로 모아 두었다가 하루 계획을 세울 때 참고한다.`,
  },
  {
    isEnabled: () => true,
    describe: () =>
      '이대리가 보낸 메시지에 👍/👎 를 달면 그 반응을 취향 학습에 쓴다.',
  },
  {
    isEnabled: hasAll('STUDY_BRIEF_OWNER_SLACK_USER_ID'),
    describe: () => '매일 아침 오늘의 공부 브리프를 보낸다.',
  },
  {
    isEnabled: hasAll('JOB_APPLICATION_NUDGE_OWNER_SLACK_USER_ID'),
    describe: () =>
      '매일 아침 마감이 3일 안으로 다가왔거나 후속 연락할 때가 지난 지원 건을 알려 준다(없으면 보내지 않는다).',
  },
  {
    isEnabled: hasAll('RESUME_CALIBRATION_OWNER_SLACK_USER_ID'),
    describe: () => '매주 이력서 보정 점검 리포트를 보낸다.',
  },
  {
    isEnabled: hasAll('AUTOPILOT_OWNER_SLACK_USER_ID'),
    describe: () => '아침 브리핑과 주간 요약을 정해진 시간에 보낸다.',
  },
  {
    isEnabled: autopilotAnd('JOB_FEED_ENABLED'),
    describe: () => '평일 아침 백엔드 채용공고를 모아 보낸다.',
  },
  {
    isEnabled: autopilotAnd('STOCK_MONITOR_ENABLED'),
    describe: () => '보유 종목을 점검해 주식 경보를 보낸다.',
  },
  {
    isEnabled: autopilotAnd('PAPER_TRADING_ENABLED'),
    describe: () => '모의투자 추천과 성적을 정해진 시간에 보낸다.',
  },
];

export const describeEnabledPassiveCapabilities = (read: EnvReader): string[] =>
  PASSIVE_CAPABILITIES.filter(({ isEnabled }) => isEnabled(read)).map(
    ({ describe }) => describe(read),
  );
