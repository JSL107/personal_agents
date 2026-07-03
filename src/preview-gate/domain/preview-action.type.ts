// PO-2 Preview Gate — 외부 부작용 명령 (Notion/GitHub write 등) 이 사용자 confirm 후에만 실행되도록 한다.
// kind 는 preview 의 의미 종류 — PreviewApplier strategy 가 같은 kind 를 implement 해 실제 부작용을 수행한다.
export const PREVIEW_KIND = {
  // PM-2: PM Agent 가 만든 DailyPlan 의 task subtasks 를 GitHub Issue 코멘트 / Notion page 로 write-back.
  PM_WRITE_BACK: 'PM_WRITE_BACK',
  // V3 §P4 careerLog: PoEval output 의 careerLog 섹션을 사용자가 지정한 Notion 페이지에
  // append 한다. payload = { careerLog, period, notionPageId }. applier 는 NotionClient.appendBlocks
  // 로 1회 append (이미 APPLIED 면 PreviewAction status 가 차단).
  PO_EVAL_CAREERLOG: 'PO_EVAL_CAREERLOG',
  // V3 Phase 2a — BE worker 가 출력한 BackendPlan 을 sandbox 안에서 검증.
  // payload = { planText, repoLabel, baseBranch } (BeSandboxApplyPayload).
  // applier 는 (Phase 2a-1 현 단계) sandbox 스모크 테스트만 — 실제 codex patch + pnpm test 는
  // 후속 PR (Phase 2a-2 / 2a-3).
  BE_SANDBOX_APPLY: 'BE_SANDBOX_APPLY',
  // V3 Phase 2b — Phase 2a-3b sandbox 가 jest 통과 후 자동 chain.
  // payload = { diff, reasoning, changedFiles, repoLabel, baseBranch } (BeSandboxPushPrPayload).
  // applier 가 octokit 으로 새 branch + commit + PR open. main 직접 push 절대 X.
  BE_SANDBOX_PUSH_PR: 'BE_SANDBOX_PUSH_PR',
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
  // 저녁 회고 — 오늘 대표 작업을 codex 로 블로그 본문 생성 후 Notion 발행.
  // payload = { topPick:{title,keywords[]}, retroContext, slackUserId } (EveningBlogPublishApplier).
  EVENING_BLOG_PUBLISH: 'EVENING_BLOG_PUBLISH',
  // 저녁 회고 — 오늘 머지된 PR 전체를 다건 통합 회고로 이력서 프로필 편입 + 포트폴리오 Notion append.
  // payload = { prRefs:string[], slackUserId } (EveningCareerReflectApplier 가 ReflectPrUsecase 위임).
  EVENING_CAREER_REFLECT: 'EVENING_CAREER_REFLECT',
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

// Slack Bolt block_actions 의 action_id 명세 — Block Kit 의 button 마다 이 값 노출.
export const PREVIEW_ACTION_IDS = {
  APPLY: 'preview:apply',
  CANCEL: 'preview:cancel',
} as const;
