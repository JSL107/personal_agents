// 말로 시키지 않아도 이대리가 하는 일(정해진 시간 발송)과 이모지로 할 수 있는 일.
//
// WORKER_CAPABILITIES 는 자연어로 실행되는 워커만 담아서, 대화 답변이 이쪽 기능을 몰랐다.
// "공고중에서 필요하지 않은 공고를 제외하는 방법 알려줘." 에 공고 제외 기능이 있는데도
// "직접 선별·제외는 못 한다" 고 답했다(2026-10-14 run 8787).
//
// 문구는 기능 쪽 안내와 따로 적혀 있다 — 기능의 조작법이 바뀌면 여기도 고친다
// (원화 공고 제외는 #804 에서 번호 이모지 → 「관심 없음」 버튼으로 바뀌었다).
//
// requiredEnv 가 하나라도 비면 그 기능은 꺼진 것이라 안내하지 않는다 — 켜는 조건은 각 기능의
// 등록 코드와 같다(art-job-exclusion-action.handler.ts, *-cron.scheduler.ts, autopilot.scheduler.ts,
// append-pushpin-task.service.ts). 내부 정리·감사 작업과 운영 알림은 사용자가 할 일이 없어 싣지 않는다.
export type EnvReader = (key: string) => string | undefined;

export interface PassiveCapability {
  requiredEnv: readonly string[];
  describe: (read: EnvReader) => string;
}

const emojiOf = (read: EnvReader, key: string, fallback: string): string =>
  `:${read(key)?.trim() || fallback}:`;

export const PASSIVE_CAPABILITIES: readonly PassiveCapability[] = [
  {
    requiredEnv: ['ART_JOB_FEED_TARGET'],
    describe: () =>
      '정해진 시간(기본 오전 9시·오후 6시)에 게임잡의 원화 채용공고를 이미지와 함께 채널에 올린다.',
  },
  {
    requiredEnv: ['ART_JOB_FEED_TARGET', 'ART_JOB_FEED_MENTION_USER_ID'],
    describe: () =>
      '원화 공고 글에서 빼고 싶은 공고 옆의 「관심 없음」 버튼을 누르면 같은 공고는 다음 회차부터 다시 보내지 않는다. 잘못 눌렀으면 「제외됨 · 되돌리기」를 누르면 된다.',
  },
  {
    requiredEnv: ['SLACK_PUSHPIN_REACTION_NOTION_PAGE_ID'],
    describe: (read) =>
      `아무 메시지에나 ${emojiOf(read, 'SLACK_PUSHPIN_REACTION_EMOJI', 'pushpin')} 이모지를 달면 그 메시지를 Notion 할 일 페이지에 옮겨 적는다.`,
  },
  {
    requiredEnv: [],
    describe: (read) =>
      `메시지에 ${emojiOf(read, 'SLACK_INBOX_EMOJI', 'raised_hand')} 이모지를 달면 할 일 후보로 모아 두었다가 하루 계획을 세울 때 참고한다.`,
  },
  {
    requiredEnv: [],
    describe: () =>
      '이대리가 보낸 메시지에 👍/👎 를 달면 그 반응을 취향 학습에 쓴다.',
  },
  {
    requiredEnv: ['STUDY_BRIEF_OWNER_SLACK_USER_ID'],
    describe: () => '매일 아침 오늘의 공부 브리프를 보낸다.',
  },
  {
    requiredEnv: ['JOB_APPLICATION_NUDGE_OWNER_SLACK_USER_ID'],
    describe: () =>
      '매일 아침 마감이 3일 안으로 다가왔거나 후속 연락할 때가 지난 지원 건을 알려 준다(없으면 보내지 않는다).',
  },
  {
    requiredEnv: ['RESUME_CALIBRATION_OWNER_SLACK_USER_ID'],
    describe: () => '매주 이력서 보정 점검 리포트를 보낸다.',
  },
  {
    requiredEnv: ['AUTOPILOT_OWNER_SLACK_USER_ID'],
    describe: () =>
      '아침 브리핑, 저녁 회고, 주간 요약, 백엔드 채용공고 수집, 모의투자·주식 알림을 정해진 시간에 보낸다.',
  },
];

export const describeEnabledPassiveCapabilities = (read: EnvReader): string[] =>
  PASSIVE_CAPABILITIES.filter(({ requiredEnv }) =>
    requiredEnv.every((key) => Boolean(read(key)?.trim())),
  ).map(({ describe }) => describe(read));
