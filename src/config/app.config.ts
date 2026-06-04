import { plainToInstance } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  validateSync,
} from 'class-validator';

class EnvironmentVariables {
  @IsNumber()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  REDIS_HOST!: string;

  @IsNumber()
  @Min(1)
  @Max(65535)
  REDIS_PORT!: number;

  // DATABASE_URL 은 이 프로젝트의 필수 인프라(Prisma + PostgreSQL) 구성요소다.
  // 강제 지점은 앱 부팅 시 class-validator 검증이다. `pnpm install`(prisma generate) 은 schema 파싱만 하므로 DATABASE_URL 없이도 성공한다.
  // 실제 DB 연결은 PrismaService 의 lazy connect 로 처리되므로, DB 가 일시적으로 다운돼도 앱 부팅은 통과하고 첫 쿼리 시점에서 에러가 드러난다.
  @IsString()
  @Matches(/^postgres(ql)?:\/\//, {
    message:
      'DATABASE_URL은 postgres:// 또는 postgresql:// 로 시작해야 합니다.',
  })
  DATABASE_URL!: string;

  // Slack 봇 토큰 (이대리 — Socket Mode). 3개 모두 설정된 경우에만 SlackService 가 기동된다.
  // 미설정 시 앱은 정상 부팅되며 Slack 관련 기능만 비활성화된다.
  @IsOptional()
  @IsString()
  SLACK_BOT_TOKEN?: string;

  @IsOptional()
  @IsString()
  SLACK_APP_TOKEN?: string;

  @IsOptional()
  @IsString()
  SLACK_SIGNING_SECRET?: string;

  // GitHub Personal Access Token. 미설정 시 GitHub 커넥터 호출 시점에 친절한 예외로 빠진다 (앱 부팅엔 영향 없음).
  @IsOptional()
  @IsString()
  GITHUB_TOKEN?: string;

  // Notion integration token + 조회할 task DB ID 콤마 구분 리스트.
  // 미설정 시 Notion 커넥터 호출 시 친절한 예외 (앱 부팅엔 영향 없음).
  @IsOptional()
  @IsString()
  NOTION_TOKEN?: string;

  @IsOptional()
  @IsString()
  NOTION_TASK_DB_IDS?: string;

  // Daily Plan write back 용 별도 DB (선택). 미설정 시 NOTION_TASK_DB_IDS 첫 번째 DB 를 재사용.
  @IsOptional()
  @IsString()
  NOTION_DAILY_PLAN_DATABASE_ID?: string;

  // PRO-1 Morning Briefing CRON 설정.
  // - OWNER_SLACK_USER_ID: PM 컨텍스트의 "누구의 plan 인지" 식별자 (GitHub assigned / Slack 멘션 fetch 기준).
  //   미설정 = 모듈 자동 비활성화 (graceful, 1인 봇이라 단일 owner).
  // - DELIVERY_TARGETS: 콤마 구분 발송 대상 — 슬랙 user ID(U...) 또는 채널 ID(C.../G...) 혼용.
  //   빈 값이면 OWNER 의 DM 으로 발송. private 채널은 봇 invite 필요.
  // - CRON: BullMQ repeatable cron pattern (default: 매일 08:30).
  // - TIMEZONE: cron 해석 기준 (default: Asia/Seoul).
  @IsOptional()
  @IsString()
  MORNING_BRIEFING_OWNER_SLACK_USER_ID?: string;

  @IsOptional()
  @IsString()
  MORNING_BRIEFING_DELIVERY_TARGETS?: string;

  @IsOptional()
  @IsString()
  MORNING_BRIEFING_CRON?: string;

  @IsOptional()
  @IsString()
  MORNING_BRIEFING_TIMEZONE?: string;

  // OPS-6 stale data filter — GitHub assigned issue / Notion task DB 의 컷오프 (일 단위).
  // 미설정 시 default 60일. 사용자가 archive 안 한 long-tail 데이터가 매일 prompt 에 누적되는 것을 차단.
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, {
    message: 'STALE_DATA_CUTOFF_DAYS 는 양의 정수 (예: "60") 만 허용합니다.',
  })
  STALE_DATA_CUTOFF_DAYS?: string;

  // OPS-3 Slack Reaction → Inbox 큐잉 시 트리거 이모지. 미설정 시 default 'raised_hand' (✋).
  // 사용자가 다른 이모지로 바꾸고 싶으면 이 env 만 변경 (예: 'pushpin', 'eyes').
  @IsOptional()
  @IsString()
  SLACK_INBOX_EMOJI?: string;

  // 📌 reaction → Notion task 자동 적재.
  // - SLACK_PUSHPIN_REACTION_EMOJI: 트리거 이모지. 미설정 시 default 'pushpin' (📌).
  //   SLACK_INBOX_EMOJI 와 다른 이모지 권장 (같은 이모지로 두 handler 가 동시 발화하면 의도 혼동).
  // - SLACK_PUSHPIN_REACTION_NOTION_PAGE_ID: 적재 대상 Notion 부모 페이지 id. 미설정 시 service skip.
  //   같은 페이지 트리를 CAREER_LOG_NOTION_PAGE_ID 와 공유해도 OK — 일별 자식 페이지 (YYYY-MM-DD) 공통 key.
  @IsOptional()
  @IsString()
  SLACK_PUSHPIN_REACTION_EMOJI?: string;

  @IsOptional()
  @IsString()
  SLACK_PUSHPIN_REACTION_NOTION_PAGE_ID?: string;

  // OPS-2 Webhook 수신부.
  // - WEBHOOK_SECRET: 자체 포맷(/v1/agent/trigger) HMAC-SHA256 키. 미설정 시 모든 요청 거부.
  // - GITHUB_WEBHOOK_SECRET: GitHub 표준(/v1/agent/github) HMAC-SHA256 키. 미설정 시 모든 요청 거부.
  // - GITHUB_WEBHOOK_DEFAULT_SLACK_USER_ID: GitHub payload 에 slackUserId 가 없으므로 자동
  //   발화될 impact-report 의 사용자 컨텍스트 매핑. 미설정 시 GitHub webhook 수신은 200 OK 지만
  //   impact-report 자동 발화는 skip.
  @IsOptional()
  @IsString()
  WEBHOOK_SECRET?: string;

  @IsOptional()
  @IsString()
  GITHUB_WEBHOOK_SECRET?: string;

  @IsOptional()
  @IsString()
  GITHUB_WEBHOOK_DEFAULT_SLACK_USER_ID?: string;

  // PRO-4 Weekly Summary CRON.
  // - WEEKLY_SUMMARY_OWNER_SLACK_USER_ID: 주간 요약을 만들 사용자(PM run 7건의 주체). 미설정 시 모듈 비활성화.
  // - WEEKLY_SUMMARY_TARGET: 슬랙 user(U...) / channel(C.../G...) ID. 미설정 시 OWNER DM 으로.
  // - WEEKLY_SUMMARY_CRON: BullMQ repeatable cron pattern (default 매주 금요일 17:00).
  // - WEEKLY_SUMMARY_TIMEZONE: cron 해석 기준 (default Asia/Seoul).
  @IsOptional()
  @IsString()
  WEEKLY_SUMMARY_OWNER_SLACK_USER_ID?: string;

  @IsOptional()
  @IsString()
  WEEKLY_SUMMARY_TARGET?: string;

  @IsOptional()
  @IsString()
  WEEKLY_SUMMARY_CRON?: string;

  @IsOptional()
  @IsString()
  WEEKLY_SUMMARY_TIMEZONE?: string;

  // workflow-phase-definition §5.2 Daily Eval CRON.
  // - DAILY_EVAL_OWNER_SLACK_USER_ID: 일일 PO_EVAL 자동 트리거 대상 사용자. 미설정 시 모듈 비활성화.
  //   (WEEKLY 와 같은 값 권장 — 단일 사용자, 단 분리 가능.)
  // - DAILY_EVAL_TARGET: 슬랙 user(U...) / channel(C.../G...) ID. 미설정 시 OWNER DM 으로.
  // - DAILY_EVAL_CRON: BullMQ repeatable cron pattern (default 매일 19:00 — `0 19 * * *`).
  // - DAILY_EVAL_TIMEZONE: cron 해석 기준 (default Asia/Seoul).
  @IsOptional()
  @IsString()
  DAILY_EVAL_OWNER_SLACK_USER_ID?: string;

  @IsOptional()
  @IsString()
  DAILY_EVAL_TARGET?: string;

  @IsOptional()
  @IsString()
  DAILY_EVAL_CRON?: string;

  @IsOptional()
  @IsString()
  DAILY_EVAL_TIMEZONE?: string;

  // V3 §P4 careerLog Notion 적재 — /po-eval 결과 후 사용자가 "📝 Notion 적재" 버튼
  // 누를 때 append 대상 Notion 페이지 id. 미설정 시 /po-eval 응답은 기존 텍스트만 (버튼 X).
  // 한 사람 = 한 careerLog 페이지 가정 (1인 봇). 향후 멀티 사용자 시 owner→pageId map 으로 확장.
  @IsOptional()
  @IsString()
  CAREER_LOG_NOTION_PAGE_ID?: string;

  // `/impact-report --recent <N>d` — 다중 PR 종합 조회 시 author(GitHub login) + repo (선택).
  // - IMPACT_REPORT_GITHUB_AUTHOR: GitHub username (예: "JSL107") — **필수**. slackUserId →
  //   GitHub login 매핑 인프라 없는 1인 봇 임시 정책.
  // - IMPACT_REPORT_GITHUB_REPO: "owner/repo" (예: "JSL107/personal_agents") — **선택**.
  //   - 설정 시: 해당 repo 의 author 머지 PR 한정.
  //   - 미설정/빈 값 시: author 가 머지한 모든 repo PR (본인 작성 PR 만, contributor 로 다른
  //     repo 에 머지한 것도 포함). GitHub search query 의 `repo:` qualifier 제거.
  // AUTHOR 미설정 시 recent mode 호출 → 명시 에러 (기존 single PR mode 는 영향 없음).
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/, {
    message:
      'IMPACT_REPORT_GITHUB_AUTHOR 는 유효한 GitHub 사용자명이어야 합니다 (영숫자+하이픈, 1~39자, GitHub 정책 준수).',
  })
  IMPACT_REPORT_GITHUB_AUTHOR?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[^/\s]+\/[^/\s]+$/, {
    message: 'IMPACT_REPORT_GITHUB_REPO 는 "owner/repo" 형식이어야 합니다.',
  })
  IMPACT_REPORT_GITHUB_REPO?: string;

  // `/impact-report --recent <N>d` 주 1회 자동 cron — Weekly Summary / Daily Eval 과 별도.
  // - IMPACT_REPORT_RECENT_OWNER_SLACK_USER_ID: 자동 발화 대상 사용자. 미설정 시 모듈 비활성화.
  // - IMPACT_REPORT_RECENT_TARGET: 발송 대상 (Slack user U... / channel C.../G...). 미설정 시 OWNER DM.
  // - IMPACT_REPORT_RECENT_CRON: BullMQ repeatable cron (default 매주 토 09:00 — `0 9 * * 6`).
  // - IMPACT_REPORT_RECENT_TIMEZONE: cron 해석 기준 (default Asia/Seoul).
  // - IMPACT_REPORT_RECENT_DAYS: `--recent <N>d` 의 N (default 7, 범위 1~365).
  // 추가 필수: IMPACT_REPORT_GITHUB_AUTHOR (recent mode 핵심).
  @IsOptional()
  @IsString()
  IMPACT_REPORT_RECENT_OWNER_SLACK_USER_ID?: string;

  @IsOptional()
  @IsString()
  IMPACT_REPORT_RECENT_TARGET?: string;

  @IsOptional()
  @IsString()
  IMPACT_REPORT_RECENT_CRON?: string;

  @IsOptional()
  @IsString()
  IMPACT_REPORT_RECENT_TIMEZONE?: string;

  @IsOptional()
  @IsString()
  @Matches(/^([1-9][0-9]?|[12][0-9]{2}|3[0-5][0-9]|36[0-5])$/, {
    message: 'IMPACT_REPORT_RECENT_DAYS 는 1~365 사이 정수여야 합니다.',
  })
  IMPACT_REPORT_RECENT_DAYS?: string;

  // claude CLI 가 인증 만료 / 쿼터 소진으로 침묵 실패 (exit=1 + 빈/인증 키워드 stderr) 시 owner DM
  // 으로 즉시 알릴 Slack user ID (`U...`). 미설정 시 NoopClaudeAuthAlerter (stdout warn 만).
  // 2026-05-30 Daily Eval 실패 사고와 같은 primary 침묵 실패를 5초 안 owner 가 인지하기 위한 surface.
  @IsOptional()
  @IsString()
  CLAUDE_AUTH_ALERT_OWNER_SLACK_USER_ID?: string;

  // pull_request.opened webhook 자동 /review-pr 활성 — payload.pull_request.user.login 과
  // 일치하는 PR (본인 작성) + bot 작성 제외. 미설정 시 자동 review 비활성 (impact-report / BE-FIX 자동은 그대로).
  // 결과는 GITHUB_WEBHOOK_DEFAULT_SLACK_USER_ID 사용자에게 Slack DM 으로 발송.
  @IsOptional()
  @IsString()
  GITHUB_WEBHOOK_OWNER_LOGIN?: string;

  // ====== CEO Meta Cron — 주 1회 자동 /ceo-review (V3 phase loop 메타 회고) ======
  // Daily Eval (`0 19 * * *`) 가 누적한 PO_EVAL run 들을 CEO worker 가 합성.
  // - CEO_META_CRON_OWNER_SLACK_USER_ID: 회고 주체. 미설정 시 모듈 비활성화.
  // - CEO_META_CRON_TARGET: 발송 대상 (Slack user U... / channel C.../G...). 미설정 시 OWNER DM.
  // - CEO_META_CRON_CRON: BullMQ repeatable cron (default 일요일 18:00 — `0 18 * * 0`).
  // - CEO_META_CRON_TIMEZONE: cron 해석 기준 (default Asia/Seoul).
  // - CEO_META_CRON_RANGE: 'TODAY' | 'WEEK' (default WEEK).
  @IsOptional()
  @IsString()
  CEO_META_CRON_OWNER_SLACK_USER_ID?: string;

  @IsOptional()
  @IsString()
  CEO_META_CRON_TARGET?: string;

  @IsOptional()
  @IsString()
  CEO_META_CRON_CRON?: string;

  @IsOptional()
  @IsString()
  CEO_META_CRON_TIMEZONE?: string;

  @IsOptional()
  @IsString()
  CEO_META_CRON_RANGE?: string;

  // Daily Eval / Impact Report Recent / CEO Meta Cron 등 cron consumer 가 graceful skip (NO_xxx) 외
  // throw 직전에 owner 에게 DM 으로 알릴 Slack user ID (`U...`). 미설정 시 NoopCronFailureAlerter
  // (stdout warn 만). CLAUDE_AUTH_ALERT_OWNER 와 별도로 둬 cron 알람만 분리 구독 가능.
  // 30분 dedupe 는 cron 별로 적용 (한 cron 의 연쇄 실패 알람 폭주 방지).
  @IsOptional()
  @IsString()
  CRON_FAILURE_ALERT_OWNER_SLACK_USER_ID?: string;

  // pull_request.closed (merged=true) webhook 시 본인 PR 의 메타를 Notion careerLog 페이지에 자동 적재.
  // `true` (string) 일 때만 활성. 추가 조건: CAREER_LOG_NOTION_PAGE_ID + GITHUB_WEBHOOK_OWNER_LOGIN 모두 설정.
  // 미설정 / `false` 시 webhook 분기 자체 skip (impact-report / BE-FIX / review 자동은 그대로).
  @IsOptional()
  @IsString()
  PR_CAREERLOG_AUTO_ENABLED?: string;

  // issues.opened webhook 자동 라벨링 — `true` (string) 일 때만 활성.
  // 정책: 새 label 생성 X (repo 기존 vocab 안에서 LLM 분류 부분집합 선택).
  // 추가 조건: GITHUB_TOKEN 이 `Issues: Read+Write` scope 보유.
  @IsOptional()
  @IsString()
  GITHUB_ISSUE_AUTO_LABEL_ENABLED?: string;

  // 자동 라벨링 대상 repo allowlist (콤마 구분 "owner/repo"). 미설정/빈 값 → enable 만으로 모든 repo 적용.
  // monorepo / 다중 repo 환경에서 일부 repo 만 자동 라벨링 적용하고 싶을 때 사용.
  @IsOptional()
  @IsString()
  GITHUB_ISSUE_AUTO_LABEL_REPOS?: string;

  // BE 자율 개발 Phase 2a-3 — sandbox 안 `git apply --check` 검증 시 host 의 어느 repo 를
  // /repo 에 read-only 마운트할지. 미설정 시 process.cwd() (봇 자신의 작업 디렉터리) 사용.
  // 향후 multi-repo 운영 시 자연어 입력에서 추출한 repoLabel → host path mapping 으로 확장.
  @IsOptional()
  @IsString()
  BE_SANDBOX_HOST_REPO_PATH?: string;

  // BE 자율 개발 자동 chain — BE worker 가 BackendPlan 출력 직후 자동으로 BE_SANDBOX_APPLY preview
  // 생성 (사용자 "응" → Claude diff + sandbox jest + PR open chain). 'true' 일 때만 활성.
  // 미설정/false → BE worker 결과는 텍스트만 (기존 동작).
  @IsOptional()
  @IsString()
  BE_AUTONOMOUS_FROM_PLAN?: string;

  // BE_AUTONOMOUS_FROM_PLAN 활성 시 preview 의 repoLabel 기본값 ("owner/repo").
  // 미설정 시 "JSL107/personal_agents" (봇 자신 repo 가정).
  @IsOptional()
  @IsString()
  @Matches(/^[^/\s]+\/[^/\s]+$/, {
    message: 'BE_SANDBOX_DEFAULT_REPO_LABEL 은 "owner/repo" 형식이어야 합니다.',
  })
  BE_SANDBOX_DEFAULT_REPO_LABEL?: string;

  // BE_AUTONOMOUS_FROM_PLAN 활성 시 preview 의 baseBranch 기본값. 미설정 시 "main".
  @IsOptional()
  @IsString()
  BE_SANDBOX_DEFAULT_BASE_BRANCH?: string;
}

export const validateEnv = (config: Record<string, unknown>) => {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  return validated;
};
