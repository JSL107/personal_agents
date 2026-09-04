// 차단 사유 상용구 사전 — 실패·스킵·미연동 카드가 같은 형식으로 말하게 하는 한 곳.
//
// 형식은 세 조각이다.
//   ① 안 되는 진짜 이유 — 부류마다 다르므로 호출부가 가진 문구를 그대로 쓴다.
//   ② 없는 값을 지어내지 않는다는 선언 — 지금 어느 카드에도 없던 조각.
//   ③ 풀리면 무엇을 하는지.
// 사전은 ②③만 든다. ①을 여기서 만들려 하면 호출부마다 다른 맥락(에이전트명·키 이름·경과시간)을
// 사전이 알아야 해서, 결국 사전이 호출부를 흉내 내게 된다.

export type BlockReasonKind = 'QUOTA' | 'INTEGRATION' | 'PREREQUISITE';

export interface BlockReasonPhrase {
  readonly noFabrication: string;
  readonly recovery: string;
  // 이 부류에서 ③을 "이미 말했다" 고 볼 문구. 부류마다 다르다 — 미연동 문구의
  // "잠시 후 다시 시도" 는 키를 넣으라는 말이 아니라서, 공통 신호 하나로 판정하면
  // 정작 필요한 안내가 사라진다.
  readonly recoveryStatedSignals: readonly string[];
}

// 원장(AgentRun.output.error)과 DomainException 은 errorCode 가 아니라 message 문자열만 남긴다.
// 그래서 판정 단서가 문자열밖에 없다. 실측 출처:
//  - QUOTA: `src/model-router/application/model-router.usecase.ts:223` describeQuotaExhaustion
//  - INTEGRATION: `src/github/infrastructure/octokit-github.client.ts:345`,
//    `src/notion/infrastructure/notion-api.client.ts:80` 및 레포 전반의
//    `... 가 설정되지 않았습니다 (.env 확인).` 변형
//  - PREREQUISITE: `src/agent/cto/application/generate-assignment.usecase.ts:230`,
//    `src/agent/ceo/application/generate-ceo-meta.usecase.ts:128`
// 문구가 바뀌면 이 매칭은 조용히 깨진다. errorCode 를 원장에 보존하는 별도 변경 전까지 유지한다.
const QUOTA_SIGNAL = '사용량 한도 초과';
const CONFIGURATION_MISSING_SIGNAL = '설정되지 않';
const ENV_SIGNAL = '.env';
// 선행 부재는 두 조각으로 본다 — "무엇이 없다" + "대표가 실행할 것이 있다".
// 한 조각(예: 연속 문자열 '먼저 실행')만 보면 같은 사정을 달리 쓴 문구를 통째로 놓친다.
// `먼저 \`/today\` 로 plan 을 생성한 뒤` (po-shadow·sync-plan) 와
// `새로운 \`/today\` 실행 후` (구버전 출력 경로) 가 그렇게 빠져 있었다.
const MISSING_SIGNAL = '없';
const PREREQUISITE_ACTION_SIGNALS: readonly RegExp[] = [
  /먼저/,
  /`\/[a-z][a-z0-9-]*`/,
];

export const BLOCK_REASON_PHRASES: Readonly<
  Record<BlockReasonKind, BlockReasonPhrase>
> = {
  QUOTA: {
    noFabrication: '한도가 풀릴 때까지 결과를 지어내지 않습니다.',
    recovery: '한도가 리셋되면 자동으로 다시 쓸 수 있습니다.',
    // 쿼터의 ③은 "리셋될 때까지 기다렸다 다시" 라서, 그 말이 이미 있으면 같은 안내다.
    recoveryStatedSignals: ['다시 시도'],
  },
  INTEGRATION: {
    noFabrication: '연동 전에는 없는 값을 지어내지 않습니다.',
    recovery: '`.env` 에 해당 키를 넣고 다시 시도하면 바로 돌아요.',
    // 미연동의 ③은 "어디에 무엇을 넣어라" 다. 일반적인 재시도 권유는 여기에 해당하지 않는다
    // — `resolve-hire-date.ts:15` 처럼 넣을 키까지 적어 준 문구만 이미 말한 것으로 본다.
    recoveryStatedSignals: ['설정해주세요'],
  },
  PREREQUISITE: {
    noFabrication: '선행 산출물 없이 내용을 지어내지 않습니다.',
    recovery: '선행 작업을 먼저 실행하면 이어서 진행됩니다.',
    // 판정 신호 자체가 실행 지시라 사실상 늘 여기 걸린다. recovery 는 신호가 실행 지시를
    // 담지 않는 문구까지 넓어질 때를 위한 기본값이다.
    recoveryStatedSignals: ['먼저', '실행'],
  },
};

// ③을 이미 담고 있는 문구인가. 사전 밖에서 문장을 조립하는 곳(카드 formatter 등)도 같은
// 기준을 써야 한 화면에서 같은 안내가 두 번 나오지 않는다.
export const statesRecoveryAlready = (
  reason: string,
  kind: BlockReasonKind,
): boolean => {
  return BLOCK_REASON_PHRASES[kind].recoveryStatedSignals.some((signal) =>
    reason.includes(signal),
  );
};

export const classifyBlockReason = (reason: string): BlockReasonKind | null => {
  if (
    reason.includes(CONFIGURATION_MISSING_SIGNAL) &&
    reason.includes(ENV_SIGNAL)
  ) {
    return 'INTEGRATION';
  }
  if (reason.includes(QUOTA_SIGNAL)) {
    return 'QUOTA';
  }
  if (
    reason.includes(MISSING_SIGNAL) &&
    PREREQUISITE_ACTION_SIGNALS.some((signal) => signal.test(reason))
  ) {
    return 'PREREQUISITE';
  }
  return null;
};

// ①만 있는 기존 문구에 빠진 조각을 채운다. 부류를 못 알아보면 원문 그대로 돌려준다 —
// 모르는 실패에 아는 척하는 조치를 붙이는 쪽이 더 나쁘다.
export const appendBlockReasonGuidance = (reason: string): string => {
  const kind = classifyBlockReason(reason);
  if (kind === null) {
    return reason;
  }
  const phrase = BLOCK_REASON_PHRASES[kind];
  const parts = [reason];
  if (!reason.includes(phrase.noFabrication)) {
    parts.push(phrase.noFabrication);
  }
  if (
    !statesRecoveryAlready(reason, kind) &&
    !reason.includes(phrase.recovery)
  ) {
    parts.push(phrase.recovery);
  }
  return parts.join(' ');
};
