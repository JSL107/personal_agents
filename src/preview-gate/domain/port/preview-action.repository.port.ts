import {
  ApplyProgressState,
  CreatePreviewInput,
  PreviewAction,
  PreviewKind,
  PreviewStatus,
} from '../preview-action.type';

export const PREVIEW_ACTION_REPOSITORY_PORT = Symbol(
  'PREVIEW_ACTION_REPOSITORY_PORT',
);

// Ops Supervisor — kind 별 preview 종결 집계. reject = cancelled + expired.
export interface PreviewOutcomeRow {
  kind: string;
  applied: number;
  cancelled: number;
  expired: number;
}

// 대표 브리핑 연속 기록 — 카드 한 장의 생애를 시각 두 개로 압축한 것.
// `closedAt` 은 승인(appliedAt)·거절(cancelledAt) 중 실제로 찍힌 값이고, 무응답 만료는 null 이다.
export interface PreviewDayOutcomeRow {
  createdAt: Date;
  closedAt: Date | null;
}

export interface PreviewActionRepositoryPort {
  // 새 preview 를 PENDING 상태로 생성. id 는 어댑터가 uuid 생성. expiresAt 은 ttlMs 기반 계산.
  create(input: CreatePreviewInput): Promise<PreviewAction>;
  findById(id: string): Promise<PreviewAction | null>;
  // 사용자별 가장 최근 PENDING preview — 자연어 Y/N 응답 흐름에서
  // "응" / "아니" 입력을 어떤 preview 에 매핑할지 결정할 때 사용한다.
  // 만료된(expiresAt <= now) row 는 제외 (만료된 건 apply 불가).
  findLatestPendingForUser(input: {
    slackUserId: string;
    now: Date;
  }): Promise<PreviewAction | null>;
  // PENDING → status 전이. appliedAt / cancelledAt 은 status 에 맞춰 채워진다.
  // 멱등성: 이미 APPLIED/CANCELLED/EXPIRED 인 row 는 호출자 (usecase) 가 미리 검증해 막는다.
  transition(input: {
    id: string;
    status: Exclude<PreviewStatus, 'PENDING'>;
  }): Promise<PreviewAction>;
  // 기대 상태일 때만 전이한다. 아니면 아무것도 쓰지 않고 null 을 돌려준다.
  //
  // `transition` 은 id 만 보고 덮어쓰므로 "조회 시점의 상태" 를 믿는 호출자는 경합에 진다 —
  // 스위퍼가 PENDING 목록을 뽑은 뒤 사용자가 ✅ 를 누르면, 방금 APPLIED 가 된 row 위에
  // EXPIRED 를 덮어쓴다. 그 상태로 만료 후처리(canceller)까지 돌면 이미 APPROVED 로 기록된
  // 연동 레코드가 EXPIRED 로 되돌아가 결과가 손상된다.
  //
  // 반환값이 곧 "전이를 획득했는가" 다 — 부작용이 있는 후처리는 획득한 쪽만 실행해야 한다.
  transitionIfStatus(input: {
    id: string;
    from: PreviewStatus;
    to: PreviewStatus;
  }): Promise<PreviewAction | null>;
  // PENDING 카드의 payload 만 교체. 사용자가 카드 위 컨트롤(드롭다운 등)로 승인 내용을
  // 고쳐 나갈 때 쓴다 — 카드를 새로 만들면 승인 대상이 갈라지므로 같은 카드를 갱신한다.
  // status 전이는 하지 않는다. PENDING/owner 검증은 호출자(usecase) 책임.
  updatePayload(input: {
    id: string;
    payload: unknown;
  }): Promise<PreviewAction>;
  countOutcomesByKind(input: {
    sinceDays: number;
    now: Date;
  }): Promise<PreviewOutcomeRow[]>;
  // 같은 작업(payload 특정 키)에 이미 카드를 낸 적이 있는지 — status 무관.
  // 어떤 결말이든 이미 물어본 사실은 같으므로 무응답 만료 후 같은 제안을 반복하지 않는다.
  countByPayloadValue(input: {
    kind: string;
    payloadPath: string[];
    payloadValue: string;
  }): Promise<number>;
  // 승인 후 실행이 실패한 흔적을 남긴다. status 는 건드리지 않는다 — 실행 실패는 거부가 아니고,
  // 거부로 기록하면 preview-canceller.port.ts 가 경고한 것과 같은 학습 오염이 된다.
  // 실패해도 row 는 PENDING 을 유지하므로, 이 두 값이 없으면 실패를 사후에 셀 방법이 없다.
  recordApplyFailure(input: {
    id: string;
    reason: string;
    at: Date;
  }): Promise<void>;
  // 반영 소유권을 **조건부로** 획득한다. 재개면 직전 `done` 을 물려받고 시도 횟수만 올린다 —
  // 물려받지 않으면 재개가 처음부터 다시 돌아 이어붙이는 의미가 없다.
  //
  // 반환값이 이번 시도의 진행 상태이고, 호출자는 여기 담긴 `done` 을 applier 에 그대로 넘긴다.
  // **`null` 은 획득 실패다** — 아직 끝나지 않은 남의 반영이 있거나, 읽은 뒤 쓰기 전에 다른
  // 쪽이 먼저 잡았다는 뜻이므로 호출자는 거기서 멈춰야 한다. 그냥 진행하면 같은 반영이 두
  // 프로세스에서 동시에 돈다.
  //
  // `takeOverPid` 는 **그 프로세스가 죽은 것을 호출자가 확인한 경우에만** 넘긴다(부팅 훅).
  // 죽은 프로세스는 스스로 종료 표시를 남기지 못해 그 흔적이 살아 있는 소유자와 구분되지
  // 않는다 — 확인 책임을 호출자에게 두고, 여기서는 명시된 것만 이어받는다.
  beginApply(input: {
    id: string;
    pid: number;
    at: Date;
    takeOverPid?: number;
  }): Promise<ApplyProgressState | null>;
  // 이 시도가 끝났음을 표시한다(실패·마감 경로). `done` 은 남긴다 — 이미 반영된 단계를 지우면
  // 다음 승인이 그것을 처음부터 다시 실행한다.
  //
  // 성공 경로는 `clearApplyProgress` 로 통째로 지운다. 카드가 APPLIED 로 끝나 다시 눌릴 일이 없다.
  endApply(input: { id: string; pid: number; at: Date }): Promise<void>;
  // 단계 하나가 끝났음을 덧붙인다. 같은 단계가 두 번 들어오면 무시한다 — 재개가 기록을
  // 물려받으므로 중복 호출이 실제로 일어날 수 있고, 중복이 쌓이면 `done` 이 진행을 과장한다.
  recordApplyStep(input: { id: string; step: string }): Promise<void>;
  // 반영이 끝났다(성공이든 실패든) — 흔적을 지운다. 지우지 않으면 다음 부팅이 중단으로 오인해
  // 끝난 반영을 되살린다.
  //
  // **내가 새긴 흔적만 지운다.** 다른 프로세스가 같은 카드를 쥐고 있으면 그쪽 기록이 정본이고,
  // 그것까지 지우면 그 반영이 죽었을 때 부팅 훅이 중단을 알아보지 못한다.
  clearApplyProgress(input: { id: string; pid: number }): Promise<void>;
  // 흔적이 남은 채 아직 PENDING 인 카드 전부 — 부팅 훅의 입력이다.
  // 살아 있는 프로세스의 것도 함께 나오므로, 중단 판정은 호출자가 pid 생존으로 가른다.
  findApplyInterrupted(): Promise<PreviewAction[]>;
  // A 경로 카드 발송 후 좌표 저장. 이후 apply/cancel/만료 시 chat.update 로 이 메시지를 갱신한다.
  attachSlackMessage(input: {
    id: string;
    slackChannelId: string;
    slackMessageTs: string;
  }): Promise<void>;
  // 만료됐지만 아직 PENDING 인 카드 — preview-sweeper 가 EXPIRED 전이 + 카드 갱신 대상으로 소비.
  findExpiredPending(input: {
    now: Date;
    limit: number;
  }): Promise<PreviewAction[]>;
  // 콘솔 관제 — 아직 열려 있는(PENDING & 미만료) preview 전체. 사용자 구분 없이 모두 조회.
  findAllOpen(input: { now: Date }): Promise<PreviewAction[]>;
  // 대표 브리핑 연속 기록 — 카드가 언제 떠서 언제 결말이 났는지만 전건 조회.
  //
  // 창을 두지 않는 이유: 최고 기록에 창을 씌우면 오래된 기록이 창 밖으로 밀려나며 "최고" 가
  // 줄어든다. 로컬 원장은 161행이라 전수 조회가 창 계산보다 싸다.
  //
  // payload / previewText 를 빼고 두 시각만 가져온다 — 연속 기록에는 카드 내용이 필요 없고,
  // 전건 조회에 큰 jsonb 를 딸려 오게 하면 이 값이 커질 때 조용히 무거워진다.
  // 실제로 적용된 카드만 kind 별로 조회한다 — 중복 발행 판정처럼 "정말 나갔는가" 를 물어야
  // 하는 곳이 쓴다.
  //
  // 후보를 만든 실행 기록(agent_run)으로 대신하면 안 된다. 그건 카드를 **띄운** 시점의
  // 기록이라 사용자가 거절했거나 무응답으로 만료된 회차까지 "나간 것" 으로 세게 된다.
  findRecentAppliedByKind(input: {
    kind: PreviewKind;
    since: Date;
    limit: number;
  }): Promise<PreviewAction[]>;
  findAllDayOutcomes(): Promise<PreviewDayOutcomeRow[]>;
}
