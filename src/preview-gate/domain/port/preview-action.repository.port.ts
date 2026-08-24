import {
  CreatePreviewInput,
  PreviewAction,
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
  findAllDayOutcomes(): Promise<PreviewDayOutcomeRow[]>;
}
