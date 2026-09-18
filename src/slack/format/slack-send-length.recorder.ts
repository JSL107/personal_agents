import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { Logger } from '@nestjs/common';

// 발송 길이 계측 — "어느 메시지가 실제로 긴가" 를 재는 자리
// (`docs/superpowers/specs/2026-09-18-slack-message-readability-design.md` §7-5).
//
// `agent_run.output` 으로는 잴 수 없다. 그건 모델이 낸 원재료라 Slack 에 실리지 않는 부분까지
// 들어 있다 — EVENING_RETRO 는 output 5,072자인데 실제 발송 본문은 210~388자였다(2026-09-18 실측).
// 그 오독으로 "메시지가 길다" 의 근거가 무너져 설계서 §4 의 두 항목이 보류됐다. 그래서 추정을
// 그만두고 Slack 이 실제로 받는 최종 문자열을 나가기 직전에 센다.
//
// 기록 시점은 "발송 직전" 이지 "발송 성공 후" 가 아니다. 발송이 실패해도 한 줄이 남지만,
// 길이 분포를 보는 목적에는 무해하고 성공 여부로 분기하면 pull 경로(respond/say)와 시점이
// 어긋나 같은 축으로 비교할 수 없게 된다.

// 발송 경로 구분. 한 메시지가 두 번 기록되지 않도록 값을 아는 쪽만 넘긴다 —
// 기본값 `reply` 는 사용자가 먼저 부른 응답(슬래시·멘션·블로그 답장), `push` 계열은
// 이대리가 먼저 밀어내는 자율 메시지다. "안 읽게 된다" 의 대상은 후자다.
export type SlackSendOrigin = 'push' | 'push-thread' | 'reply' | 'card';

// cron 요약은 여러 task 의 요약을 이 구분선으로 이어 붙여 한 메시지로 보낸다
// (`autopilot.orchestrator.ts` 의 `mainText`). 3,000자가 하나짜리인지 넷을 붙인 것인지에 따라
// 처방이 갈리므로(각 요약을 줄일 일 vs 붙이는 것을 그만둘 일) 조각 수를 함께 센다.
// orchestrator 를 고치지 않고 최종 문자열만 보고 세려고 구분선을 그대로 재사용한다.
//
// **줄 전체가 구분선인 경우만 센다.** 부분일치로 세면 본문에 같은 문자가 섞이거나 모델이
// 더 긴 가로줄을 그렸을 때 조각 수가 부풀어 오른다 — 그 값이 §4 재판단의 판단 축이라
// 부풀면 엉뚱한 처방으로 간다.
//
// ⚠️ 이 값은 "병합된 task 수" 가 아니라 **구분선으로 나뉜 조각 수**다. 한 task 의 요약이
// 내부에 같은 구분선을 쓰는 경우가 있다 — `weekly-summary.autopilot-task.ts:167` 이
// worklog+건강 줄과 CEO 요약을 그 구분선으로 잇는다. 그 task 는 단독 발송인데도 조각이 2다.
// task 수로 읽으면 틀리고, 조각 수로 읽으면 맞다(붙여 보낸 덩어리가 몇 개인가).
const DIGEST_SEPARATOR_LINE = /^────────$/gm;

// 목록에서 어느 메시지인지 눈으로 가리는 축. 길게 잡으면 계측 파일이 본문 사본이 된다.
const HEAD_LENGTH = 60;

const LOG_RELATIVE_PATH = 'logs/slack-send.jsonl';

export type SlackSendRecord = {
  at: string;
  origin: SlackSendOrigin;
  chars: number;
  parts: number;
  blocks: number;
  head: string;
};

type SlackSendRecordInput = {
  text: string;
  origin: SlackSendOrigin;
  blocks?: number;
  at?: Date;
};

export const buildSlackSendRecord = ({
  text,
  origin,
  blocks,
  at,
}: SlackSendRecordInput): SlackSendRecord => ({
  at: (at ?? new Date()).toISOString(),
  origin,
  chars: text.length,
  parts: (text.match(DIGEST_SEPARATOR_LINE)?.length ?? 0) + 1,
  blocks: blocks ?? 0,
  head: text.replace(/\s+/g, ' ').trim().slice(0, HEAD_LENGTH),
});

const logger = new Logger('SlackSendLength');

let writeFailureLogged = false;

// ponytail: 파일이 무한히 자란다(하루 약 1,000줄 · 200KB). 몇 주는 문제없고, 길어지면
// 날짜별 파일이나 로테이션으로 올린다.
export const recordSlackSendLength = (input: SlackSendRecordInput): void => {
  // 테스트 문자열은 계측 대상이 아니다 — spec 이 `toReadableSlackArgs` 를 직접 부르므로
  // 막지 않으면 실제 분포에 섞인다. DI 컨텍스트 밖 유틸이라 `process.env` 직접 참조가
  // 허용된다 (CODE_RULES §9-2).
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  try {
    const path = resolve(process.cwd(), LOG_RELATIVE_PATH);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(buildSlackSendRecord(input))}\n`);
  } catch (error: unknown) {
    // 계측 실패가 발송을 막으면 주객전도다 — 삼키고 메시지는 그대로 내보낸다.
    // 다만 완전히 조용하면 하루를 기다린 끝에 빈 파일을 보게 된다(쓰기 권한·디스크·cwd).
    // 그래서 처음 한 번만 남긴다. 매번 남기면 발송마다 같은 줄이 쌓여 진짜 경고를 덮는다.
    if (!writeFailureLogged) {
      writeFailureLogged = true;
      logger.warn(
        `발송 길이 계측 기록 실패 — 이후 조용히 건너뛴다: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
};
