// PO-2 Preview Gate — 외부 부작용 명령 (Notion/GitHub write 등) 이 사용자 confirm 후에만 실행되도록 한다.
// kind 는 preview 의 의미 종류 — PreviewApplier strategy 가 같은 kind 를 implement 해 실제 부작용을 수행한다.
export const PREVIEW_KIND = {
  // PM-2: PM Agent 가 만든 DailyPlan 의 task subtasks 를 GitHub Issue 코멘트 / Notion page 로 write-back.
  PM_WRITE_BACK: 'PM_WRITE_BACK',
  // V3 §P4 careerLog: PoEval output 의 careerLog 섹션을 사용자가 지정한 Notion 페이지에
  // append 한다. payload = { careerLog, period, notionPageId }. applier 는 NotionClient.appendBlocks
  // 로 1회 append (이미 APPLIED 면 PreviewAction status 가 차단).
  PO_EVAL_CAREERLOG: 'PO_EVAL_CAREERLOG',
  // Phase 2 — JD 갭 분석 후 주제 선택 대기. applier 없음(ApplyPreview 안 거치고
  // router-message intercept 가 직접 BLOG 체인 + cancel 로 consume).
  CAREER_JD_GAP_BLOG: 'CAREER_JD_GAP_BLOG',
  // docs-sync-audit Phase 2 — 확정 문서 수정 제안을 docs PR 로 open.
  // payload = { files:[{path,content}], changedFiles, rationale, repoLabel, baseBranch } (DocsAuditPrPayload).
  // applier 가 githubClient.pushBranchAndOpenPr 로 새 branch+commit+PR. main 직접 push X.
  DOCS_AUDIT_PR: 'DOCS_AUDIT_PR',
  // 선호 프로필 자가학습 — 주간 추론이 만든 프로필 diff 를 승인 시 적용.
  // payload = { proposalId } (PreferenceProfilePreviewApplier 가 applyService.apply 로 반영).
  PREFERENCE_PROFILE: 'PREFERENCE_PROFILE',
  // AI CLI 환경 복원 — 다른 PC에서 만든 snapshot을 승인 후 bootstrap으로 적용한다.
  // payload = { snapshotSha, slackUserId } (AiCliEnvApplyPreviewApplier가 applySnapshot으로 위임).
  AI_CLI_ENV_APPLY: 'AI_CLI_ENV_APPLY',
  // 저녁 회고 — 오늘 대표 작업을 근거 PR 본문 기반 codex 블로그 초안으로 생성 후 Notion 발행.
  // payload = { topPick:{title,keywords[],reason,sourceRefs[],outline[]}, sourcePrs:[{repo,number,url,title,body}], retroContext, slackUserId } (EveningBlogPublishApplier).
  EVENING_BLOG_PUBLISH: 'EVENING_BLOG_PUBLISH',
  // 노션 블로그 초안을 승인 후 GitHub main에 파일 1개로 발행.
  // payload = { pageId, path, content, title, notionUrl, tags, summary, slackUserId }.
  BLOG_GITHUB_PUBLISH: 'BLOG_GITHUB_PUBLISH',
  // 저녁 회고 — 오늘 머지된 PR 을 저장소별로 나눠 묶음마다 회고해 이력서 프로필 편입 + 포트폴리오 Notion append.
  // payload = { prGroups:string[][], slackUserId } (EveningCareerReflectApplier 가 묶음마다 ReflectPrUsecase 위임).
  // prRefs:string[] 는 그룹 도입(2026-08-31) 이전 카드의 형태 — applier 가 1개 묶음으로 받아준다.
  EVENING_CAREER_REFLECT: 'EVENING_CAREER_REFLECT',
  // CTO 분배 확정 — 사용자가 분배 결과에 "응" 하면 BE / BE_SCHEMA / BE_TEST 를 순차 실행.
  // payload = { ctoAgentRunId, slackUserId, assignments } (CtoBeChainPayload).
  // 슬래시(`/be plan ...`) 를 손으로 치던 실행 경로를 자연어 승인 한 마디로 대체하는 게 목적.
  // 자동 분배 — 2026-08-05 폐지. 생성·승인 경로(session-dispatch 모듈)를 전부 제거했다.
  // 다른 세션의 대화 맥락에 작업을 밀어 넣는 구조라 오염 위험이 컸고, 실제 승인율도 0 이었다.
  // kind 상수만 남기는 이유는 DB 에 남은 과거 카드를 콘솔이 조회할 때 매핑이 깨지지 않게 하려는 것.
  SESSION_INJECT: 'SESSION_INJECT',
  // BE 자율개발(계획 → diff 합성 → sandbox 검증 → PR) — 2026-09-04 폐지(#477).
  // 수정안을 만드는 CLI provider 가 레포를 못 보는 구조라 diff 가 `git apply` 를 통과할 수 없었다.
  // 여기도 SESSION_INJECT 와 같은 이유로 kind 상수만 남긴다 — DB 에 종결 카드 2건
  // (APPLIED 1 · CANCELLED 1, 2026-08-02~03)이 남아 있고, toDomain 이 미등록 kind 를 예외로
  // 끊으므로(preview-action.prisma.repository.ts) 그 2건을 읽는 조회가 하나라도 생기면 터진다.
  // 행을 지우지 않는 이유는 승인/거절 원장이고 PreviewDecisionSignalSource 가 그 이력을 읽기 때문.
  BE_SANDBOX_APPLY: 'BE_SANDBOX_APPLY',
} as const;

export type PreviewKind = (typeof PREVIEW_KIND)[keyof typeof PREVIEW_KIND];

export const PREVIEW_STATUS = {
  PENDING: 'PENDING',
  APPLIED: 'APPLIED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
} as const;

export type PreviewStatus =
  (typeof PREVIEW_STATUS)[keyof typeof PREVIEW_STATUS];

// 반영이 진행 중이라는 흔적. `preview_action.apply_progress` 에 이 형태 그대로 담긴다.
//
// 반영을 시작할 때 새기고 끝나면 지우므로, **남아 있다는 것 자체가 중단의 증거**다.
// 부팅 훅(ResumeInterruptedAppliesUsecase)이 이것만 보고 이어서 돌릴지 마감할지 정한다.
export interface ApplyProgressState {
  // 이 반영을 쥐고 있는(있던) 프로세스. 부팅 훅이 생존을 확인해 "아직 도는 중" 과 "죽어서 남은
  // 것" 을 가른다 — 로컬 DB 를 worktree 백엔드와 공유하므로 남이 돌리는 중일 수 있고,
  // 그것을 중단으로 오인해 재개하면 같은 반영이 둘이 된다.
  pid: number;
  // 이번 시도가 시작된 시각(ISO). 사후 조회가 "얼마나 돌다 죽었는지" 를 읽는 유일한 값이다.
  startedAt: string;
  // 재개를 포함한 누적 시도 횟수. 상한이 없으면 **그 반영 자체가 크래시 원인일 때 부팅마다
  // 되살아나 무한 루프가 된다** — 부팅 훅이 이 값으로 끊는다.
  attempts: number;
  // applier 가 끝냈다고 기록한 단계들. 재개는 여기 있는 단계를 건너뛴다.
  done: string[];
}

// repository / usecase 가 도메인 객체로 다룰 단위. payload 는 kind 별 자유 JSON.
export interface PreviewAction {
  id: string;
  slackUserId: string;
  kind: PreviewKind;
  payload: unknown;
  status: PreviewStatus;
  previewText: string;
  expiresAt: Date;
  createdAt: Date;
  appliedAt: Date | null;
  cancelledAt: Date | null;
  // A 경로 카드 좌표 — 없으면(B/C 경로) null. chat.update 대상 판별에 사용.
  slackChannelId: string | null;
  slackMessageTs: string | null;
  // 승인 후 실행이 실패한 마지막 흔적. 실패해도 status 는 PENDING 이라 상태만으로는 실패를 셀 수 없다.
  lastFailedAt: Date | null;
  lastFailureReason: string | null;
  // 반영이 지금 돌고 있다는 흔적. 끝나면 지워지므로 null 이 정상이다 — 남아 있으면 중단됐다는 뜻.
  applyProgress: ApplyProgressState | null;
}

// 새 preview 생성 시 호출자가 채워 넘기는 데이터. id / status / createdAt / appliedAt / cancelledAt 은 시스템이 채움.
export interface CreatePreviewInput {
  slackUserId: string;
  kind: PreviewKind;
  payload: unknown;
  previewText: string;
  // ttl 초과시 사용자가 ✅ 눌러도 EXPIRED 로 거절. default 1h 권고.
  ttlMs: number;
}

// 승인 카드 하나를 그리는 데 필요한 것 전부. 발송 어댑터(SlackNotifierPort)가 이 형태로 받는다.
//
// previewId·kind·payload 를 낱개 인자로 늘어놓지 않는 이유: 카드 종류마다 필요한 것이 다르고
// (경력 반영 카드는 묶음 수만큼 입력칸이 붙는데 그 개수·라벨·기존 값이 전부 payload 에서 나온다),
// 낱개로 두면 종류가 늘 때마다 발송 포트의 계약이 따라 넓어진다. 무엇으로 그리는지는
// preview-gate 의 개념이므로 그 묶음도 여기가 소유한다.
//
// 필드는 PreviewAction 의 부분집합이다 — 호출자는 저장된 카드 행에서 그대로 뽑아 넘긴다.
// 따로 선언한 이유는 "카드를 그리는 데 필요한 것" 이 DB 행의 형태와 같아야 할 이유가
// 없기 때문이다(상태·좌표·TTL 은 그리기와 무관하다).
export interface PreviewCardMessage {
  id: string;
  kind: PreviewKind;
  previewText: string;
  // kind 별 자유 JSON. 카드 빌더가 종류를 보고 해석한다.
  payload: unknown;
}

// Slack Bolt block_actions 의 action_id 명세 — Block Kit 의 button 마다 이 값 노출.
export const PREVIEW_ACTION_IDS = {
  APPLY: 'preview:apply',
  CANCEL: 'preview:cancel',
} as const;
