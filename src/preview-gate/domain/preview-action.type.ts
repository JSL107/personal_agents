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

// repository / usecase 가 도메인 객체로 다룰 단위. payload 는 kind 별 자유 JSON.
export interface PreviewAction {
  id: string;
  slackUserId: string;
  kind: PreviewKind;
  payload: unknown;
  status: PreviewStatus;
  previewText: string;
  responseUrl: string | null;
  expiresAt: Date;
  createdAt: Date;
  appliedAt: Date | null;
  cancelledAt: Date | null;
  // A 경로 카드 좌표 — 없으면(B/C 경로) null. chat.update 대상 판별에 사용.
  slackChannelId: string | null;
  slackMessageTs: string | null;
}

// 새 preview 생성 시 호출자가 채워 넘기는 데이터. id / status / createdAt / appliedAt / cancelledAt 은 시스템이 채움.
export interface CreatePreviewInput {
  slackUserId: string;
  kind: PreviewKind;
  payload: unknown;
  previewText: string;
  responseUrl: string | null;
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
