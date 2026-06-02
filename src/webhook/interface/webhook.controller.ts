import { InjectQueue } from '@nestjs/bullmq';
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';

import {
  GITHUB_DELIVERY_HEADER,
  GITHUB_EVENT_HEADER,
  GITHUB_SIGNATURE_HEADER,
  GITHUB_WEBHOOK_OWNER_ENV,
  GITHUB_WEBHOOK_OWNER_LOGIN_ENV,
  GITHUB_WEBHOOK_SECRET_ENV,
  GithubCheckRunEvent,
  GithubIssuesEvent,
  GithubPullRequestEvent,
  GithubWebhookPayload,
} from '../domain/github-webhook.type';
import {
  BE_FIX_QUEUE,
  BE_SRE_QUEUE,
  BeFixJobData,
  BeSreJobData,
  CODE_REVIEWER_QUEUE,
  CodeReviewerJobData,
  IMPACT_REPORT_QUEUE,
  ImpactReportJobData,
  ISSUE_LABEL_QUEUE,
  IssueLabelJobData,
  PR_CAREERLOG_QUEUE,
  PrCareerLogJobData,
  WEBHOOK_SECRET_ENV,
  WebhookTriggerPayload,
} from '../domain/webhook.type';

// OPS-2 Webhook 수신부.
// (1) /v1/agent/trigger — 이대리 자체 포맷 (WebhookTriggerPayload)
// (2) /v1/agent/github — GitHub 표준 포맷 (X-GitHub-Event 헤더 + standard issue/PR payload)
// 둘 다 HMAC-SHA256 시그니처 검증 후 issues.opened / pull_request.opened 만 impact-report 자동 발화.
@Controller('v1/agent')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    @InjectQueue(IMPACT_REPORT_QUEUE)
    private readonly impactReportQueue: Queue<ImpactReportJobData>,
    @InjectQueue(BE_FIX_QUEUE)
    private readonly beFixQueue: Queue<BeFixJobData>,
    @InjectQueue(BE_SRE_QUEUE)
    private readonly beSreQueue: Queue<BeSreJobData>,
    @InjectQueue(CODE_REVIEWER_QUEUE)
    private readonly codeReviewerQueue: Queue<CodeReviewerJobData>,
    @InjectQueue(PR_CAREERLOG_QUEUE)
    private readonly prCareerLogQueue: Queue<PrCareerLogJobData>,
    @InjectQueue(ISSUE_LABEL_QUEUE)
    private readonly issueLabelQueue: Queue<IssueLabelJobData>,
    private readonly configService: ConfigService,
  ) {}

  @Post('trigger')
  @HttpCode(HttpStatus.OK)
  async trigger(
    @Body() rawBody: string,
    @Headers('x-webhook-signature') signature: string,
  ): Promise<{ accepted: boolean }> {
    this.verifySignature({
      rawBody,
      signature,
      secretEnv: WEBHOOK_SECRET_ENV,
      headerName: 'X-Webhook-Signature',
    });

    let payload: WebhookTriggerPayload;
    try {
      payload = JSON.parse(rawBody) as WebhookTriggerPayload;
    } catch {
      throw new UnauthorizedException('Invalid JSON payload');
    }

    this.logger.log(
      `Webhook 수신 — event=${payload.event} repo=${payload.repo}`,
    );

    if (
      payload.event === 'issues.opened' ||
      payload.event === 'pull_request.opened'
    ) {
      const subject = `${payload.event.replace('.', ' ')} — ${payload.repo} #${payload.data.number ?? ''}: ${payload.data.title ?? ''}`;
      this.fireImpactReport({ subject, slackUserId: payload.slackUserId });
    }

    return { accepted: true };
  }

  // GitHub 표준 webhook 어댑터.
  // 기대 헤더: X-GitHub-Event (issues / pull_request), X-Hub-Signature-256, X-GitHub-Delivery.
  // 본문: GitHub 표준 페이로드. action="opened" 이고 GITHUB_WEBHOOK_DEFAULT_SLACK_USER_ID 가
  // 설정돼 있을 때만 impact-report 자동 발화.
  @Post('github')
  @HttpCode(HttpStatus.OK)
  async github(
    @Body() rawBody: string,
    @Headers(GITHUB_SIGNATURE_HEADER) signature: string,
    @Headers(GITHUB_EVENT_HEADER) event: string,
    @Headers(GITHUB_DELIVERY_HEADER) delivery: string,
  ): Promise<{ accepted: boolean }> {
    this.verifySignature({
      rawBody,
      signature,
      secretEnv: GITHUB_WEBHOOK_SECRET_ENV,
      headerName: 'X-Hub-Signature-256',
    });

    if (!event) {
      throw new UnauthorizedException('X-GitHub-Event 헤더 누락.');
    }

    let payload: GithubWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as GithubWebhookPayload;
    } catch {
      throw new UnauthorizedException('Invalid GitHub JSON payload');
    }

    this.logger.log(
      `GitHub Webhook 수신 — event=${event} delivery=${delivery ?? '(없음)'} repo=${payload.repository?.full_name ?? '(미상)'}`,
    );

    const slackUserId = this.configService.get<string>(
      GITHUB_WEBHOOK_OWNER_ENV,
    );
    if (!slackUserId || slackUserId.trim().length === 0) {
      this.logger.warn(
        'GITHUB_WEBHOOK_DEFAULT_SLACK_USER_ID 미설정 — 자동 발화 생략 (수신 자체는 200 OK).',
      );
      return { accepted: true };
    }

    // check_run.completed + failure → BE-SRE 분석.
    if (event === 'check_run' && this.isCheckRunFailure(payload)) {
      this.fireBeSreAnalysis({
        payload: payload as GithubCheckRunEvent,
        slackUserId,
      });
      return { accepted: true };
    }

    // pull_request.closed + merged=true → 본인 PR 머지 시 careerLog 자동 적재 (LLM X).
    // closed action 은 toImpactSubject 가 지원하지 않아 그 분기보다 위에서 가드. impact-report /
    // BE-FIX 와 무관 — 머지 시점은 사후 누적 자산 적재.
    if (event === 'pull_request' && this.isPullRequestMerged(payload)) {
      const pr = payload as GithubPullRequestEvent;
      const prRef = `${pr.repository.full_name}#${pr.pull_request.number}`;
      this.maybeFirePrCareerLog({ payload: pr, prRef, slackUserId });
      return { accepted: true };
    }

    const subject = this.toImpactSubject({ event, payload });
    if (!subject) {
      // 지원하지 않는 event/action — accept 하되 작업 발화 X (재시도 폭주 방지).
      return { accepted: true };
    }

    this.fireImpactReport({ subject, slackUserId });

    // pull_request.opened → impact-report 와 병렬로 BE-FIX 자동 분석 + (조건부) code-reviewer 자동.
    if (event === 'pull_request' && this.isPullRequestOpened(payload)) {
      const pr = payload as GithubPullRequestEvent;
      const prRef = `${pr.repository.full_name}#${pr.pull_request.number}`;
      this.fireBeFixAnalysis({ prRef, slackUserId });
      this.maybeFireCodeReview({ payload: pr, prRef, slackUserId });
    }

    // issues.opened → impact-report 와 병렬로 자동 라벨링 (env gate 통과 시).
    if (event === 'issues' && this.isIssueOpened(payload)) {
      this.maybeFireIssueAutoLabel({ payload });
    }

    return { accepted: true };
  }

  // GITHUB_ISSUE_AUTO_LABEL_ENABLED = 'true' 일 때만 활성. repo allowlist (선택) 도 일치해야 fire.
  // 새 label 생성 X — repo 의 기존 label vocab 안에서 LLM 분류로 부분집합 선택.
  private maybeFireIssueAutoLabel({
    payload,
  }: {
    payload: GithubIssuesEvent;
  }): void {
    const enabled =
      this.configService
        .get<string>('GITHUB_ISSUE_AUTO_LABEL_ENABLED')
        ?.trim() === 'true';
    if (!enabled) {
      return;
    }
    const repo = payload.repository.full_name;
    const allowlistRaw = this.configService
      .get<string>('GITHUB_ISSUE_AUTO_LABEL_REPOS')
      ?.trim();
    if (allowlistRaw && allowlistRaw.length > 0) {
      const allowed = new Set(
        allowlistRaw
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
      );
      if (!allowed.has(repo)) {
        this.logger.log(
          `Webhook issue-label skip — repo allowlist 불일치 (repo=${repo}).`,
        );
        return;
      }
    }
    this.fireIssueAutoLabel({
      repo,
      issueNumber: payload.issue.number,
      title: payload.issue.title,
      body: payload.issue.body ?? '',
    });
  }

  private fireIssueAutoLabel({
    repo,
    issueNumber,
    title,
    body,
  }: {
    repo: string;
    issueNumber: number;
    title: string;
    body: string;
  }): void {
    // 동일 issue 의 webhook 재전달 (edit/reopen 등) 시 BullMQ jobId dedup.
    const jobId = `issuelabel:${repo}#${issueNumber}`;
    void this.issueLabelQueue
      .add(
        'webhook-issue-label',
        { repo, issueNumber, title, body },
        {
          jobId,
          attempts: 2,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: 50,
          removeOnFail: 50,
        },
      )
      .catch((error: unknown) => {
        this.logger.error(
          `Webhook issue-label enqueue 실패: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  // 본인 머지 PR (owner login 일치, bot 제외, env gate 활성) 만 careerLog 자동 적재.
  // PR_CAREERLOG_AUTO_ENABLED 미설정 → 모듈 자체 비활성 (review / impact-report 자동은 그대로 유지).
  // CAREER_LOG_NOTION_PAGE_ID 미설정도 비활성 (적재 대상 페이지 부재).
  private maybeFirePrCareerLog({
    payload,
    prRef,
    slackUserId,
  }: {
    payload: GithubPullRequestEvent;
    prRef: string;
    slackUserId: string;
  }): void {
    const enabled =
      this.configService.get<string>('PR_CAREERLOG_AUTO_ENABLED')?.trim() ===
      'true';
    if (!enabled) {
      return;
    }
    const careerLogPageId = this.configService
      .get<string>('CAREER_LOG_NOTION_PAGE_ID')
      ?.trim();
    if (!careerLogPageId || careerLogPageId.length === 0) {
      this.logger.warn(
        `PR careerLog 자동 적재 skip — CAREER_LOG_NOTION_PAGE_ID 미설정 (prRef=${prRef}).`,
      );
      return;
    }
    const ownerLogin = this.configService
      .get<string>('GITHUB_WEBHOOK_OWNER_LOGIN')
      ?.trim();
    if (!ownerLogin || ownerLogin.length === 0) {
      return;
    }
    const author = payload.pull_request.user;
    if (!author) {
      return;
    }
    if (author.type === 'Bot') {
      this.logger.log(
        `PR careerLog skip — bot 작성 PR (login=${author.login}, prRef=${prRef}).`,
      );
      return;
    }
    if (author.login !== ownerLogin) {
      this.logger.log(
        `PR careerLog skip — owner 불일치 (login=${author.login} vs owner=${ownerLogin}, prRef=${prRef}).`,
      );
      return;
    }
    this.firePrCareerLog({ prRef, slackUserId });
  }

  private firePrCareerLog({
    prRef,
    slackUserId,
  }: {
    prRef: string;
    slackUserId: string;
  }): void {
    // 동일 PR 의 webhook 재전달 / 재머지 (revert 후 re-merge 등) 시 BullMQ jobId dedup.
    const jobId = `prcareerlog:${prRef}`;
    void this.prCareerLogQueue
      .add(
        'webhook-pr-careerlog',
        { prRef, slackUserId },
        {
          jobId,
          attempts: 2,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: 50,
          removeOnFail: 50,
        },
      )
      .catch((error: unknown) => {
        this.logger.error(
          `Webhook PR careerLog enqueue 실패: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  private isPullRequestMerged(
    payload: GithubWebhookPayload,
  ): payload is GithubPullRequestEvent {
    if (!('pull_request' in payload)) {
      return false;
    }
    const pr = payload as GithubPullRequestEvent;
    return pr.action === 'closed' && pr.pull_request.merged === true;
  }

  // 본인이 작성한 PR (owner login 일치, bot 제외) 일 때만 자동 /review-pr 발화.
  // OWNER_LOGIN 미설정 → 자동 review 자체 비활성 (impact-report / BE-FIX 는 그대로).
  private maybeFireCodeReview({
    payload,
    prRef,
    slackUserId,
  }: {
    payload: GithubPullRequestEvent;
    prRef: string;
    slackUserId: string;
  }): void {
    const ownerLogin = this.configService
      .get<string>(GITHUB_WEBHOOK_OWNER_LOGIN_ENV)
      ?.trim();
    if (!ownerLogin || ownerLogin.length === 0) {
      return;
    }
    const author = payload.pull_request.user;
    if (!author) {
      this.logger.warn(
        `Webhook code-reviewer skip — payload.pull_request.user 누락 (prRef=${prRef}).`,
      );
      return;
    }
    if (author.type === 'Bot') {
      this.logger.log(
        `Webhook code-reviewer skip — bot 작성 PR (login=${author.login}, prRef=${prRef}).`,
      );
      return;
    }
    if (author.login !== ownerLogin) {
      this.logger.log(
        `Webhook code-reviewer skip — owner 불일치 (login=${author.login} vs owner=${ownerLogin}, prRef=${prRef}).`,
      );
      return;
    }
    this.fireCodeReviewAnalysis({ prRef, slackUserId });
  }

  private fireCodeReviewAnalysis({
    prRef,
    slackUserId,
  }: {
    prRef: string;
    slackUserId: string;
  }): void {
    // 동일 PR 의 force-push 등으로 webhook 이 재전달돼도 BullMQ jobId 가 살아있는 동안 dedup.
    const jobId = `codereview:${prRef}`;
    void this.codeReviewerQueue
      .add(
        'webhook-code-review',
        { prRef, slackUserId },
        {
          jobId,
          attempts: 2,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: 50,
          removeOnFail: 50,
        },
      )
      .catch((error: unknown) => {
        this.logger.error(
          `Webhook code-reviewer enqueue 실패: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  // GitHub event + payload → 자체 포맷의 subject 한 줄.
  // 지원 안 하는 event/action 은 null 반환 → 자동 발화 skip.
  private toImpactSubject({
    event,
    payload,
  }: {
    event: string;
    payload: GithubWebhookPayload;
  }): string | null {
    if (event === 'issues' && this.isIssueOpened(payload)) {
      return `issues opened — ${payload.repository.full_name} #${payload.issue.number}: ${payload.issue.title}`;
    }
    if (event === 'pull_request' && this.isPullRequestOpened(payload)) {
      return `pull_request opened — ${payload.repository.full_name} #${payload.pull_request.number}: ${payload.pull_request.title}`;
    }
    return null;
  }

  private isIssueOpened(
    payload: GithubWebhookPayload,
  ): payload is GithubIssuesEvent {
    return (
      'issue' in payload && (payload as GithubIssuesEvent).action === 'opened'
    );
  }

  private isPullRequestOpened(
    payload: GithubWebhookPayload,
  ): payload is GithubPullRequestEvent {
    return (
      'pull_request' in payload &&
      (payload as GithubPullRequestEvent).action === 'opened'
    );
  }

  private isCheckRunFailure(
    payload: GithubWebhookPayload,
  ): payload is GithubCheckRunEvent {
    if (!('check_run' in payload)) {
      return false;
    }
    const cr = payload as GithubCheckRunEvent;
    return cr.action === 'completed' && cr.check_run.conclusion === 'failure';
  }

  private fireBeFixAnalysis({
    prRef,
    slackUserId,
  }: {
    prRef: string;
    slackUserId: string;
  }): void {
    // codex P1 — 같은 PR (force-push / re-deliver) 에 대해 BullMQ 가 dedup 하도록 jobId 사용.
    // BullMQ 는 동일 jobId 가 살아있는 동안 같은 job 을 재추가하지 않는다 (removeOnComplete:50 까지 보존).
    const jobId = `befix:${prRef}`;
    void this.beFixQueue
      .add(
        'webhook-be-fix',
        { prRef, slackUserId },
        {
          jobId,
          attempts: 2,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: 50,
          removeOnFail: 50,
        },
      )
      .catch((error: unknown) => {
        this.logger.error(
          `Webhook BE-Fix enqueue 실패: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  private fireBeSreAnalysis({
    payload,
    slackUserId,
  }: {
    payload: GithubCheckRunEvent;
    slackUserId: string;
  }): void {
    const { name, conclusion, head_sha, html_url, output } = payload.check_run;
    const repo = payload.repository.full_name;
    const title = output?.title ?? '(없음)';
    const summary = output?.summary ?? '';
    // 실제 workflow log 는 별도 API fetch 필요 — MVP 는 핵심 메타만 합성해 BE-SRE 에 전달.
    const stackTrace = [
      `Workflow ${name} 실패 (${conclusion ?? 'unknown'})`,
      `repo=${repo} sha=${head_sha}`,
      `url=${html_url}`,
      `output=${title}: ${summary.slice(0, 1000)}`,
    ].join('\n');

    // codex P1 — CI re-run 으로 같은 head_sha + check_run.id 가 다시 도착해도 BullMQ 가 dedup.
    const jobId = `besre:${repo}:${head_sha}:${payload.check_run.id}`;
    void this.beSreQueue
      .add(
        'webhook-be-sre',
        { stackTrace, slackUserId },
        {
          jobId,
          attempts: 2,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: 50,
          removeOnFail: 50,
        },
      )
      .catch((error: unknown) => {
        this.logger.error(
          `Webhook BE-SRE enqueue 실패: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  private fireImpactReport({
    subject,
    slackUserId,
  }: {
    subject: string;
    slackUserId: string;
  }): void {
    // BullMQ 큐로 enqueue — webhook 응답 200 즉시, consumer (concurrency=1) 가 직렬 처리.
    // 기존 fire-and-forget 은 burst (monorepo 다수 issue 동시 open) 시 LLM CLI 동시 spawn 으로
    // quota/리소스 폭주 위험 (V3 audit B2 #4 / B3 P5 / B4 H-2). 큐 도입으로 backpressure 확보.
    void this.impactReportQueue
      .add(
        'webhook-impact-report',
        { subject, slackUserId },
        {
          // transient 실패 회복 — Slack 일시 장애 / 모델 timeout / 네트워크 흔들림.
          // 30s → 1m 지수 백오프, 최대 2회 시도. quota 폭주 방지를 위해 attempts 제한.
          attempts: 2,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: 50,
          removeOnFail: 50,
        },
      )
      .catch((error: unknown) => {
        this.logger.error(
          `Webhook impact-report enqueue 실패: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  private verifySignature({
    rawBody,
    signature,
    secretEnv,
    headerName,
  }: {
    rawBody: string;
    signature: string;
    secretEnv: string;
    headerName: string;
  }): void {
    const secret = this.configService.get<string>(secretEnv);
    if (!secret) {
      // 외부 응답에는 env 변수명을 노출하지 않는다 (reconnaissance 차단). 운영 진단은 logger 로만.
      this.logger.error(
        `${secretEnv} 미설정 — ${headerName} 요청을 모두 거부합니다.`,
      );
      throw new UnauthorizedException('Webhook authentication failed.');
    }
    if (!signature?.startsWith('sha256=')) {
      throw new UnauthorizedException(
        `${headerName} 헤더가 없거나 형식이 잘못됐습니다.`,
      );
    }
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(rawBody);
    const expected = `sha256=${hmac.digest('hex')}`;
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    // length-mismatch 는 즉시 reject — 정상 caller 는 항상 71 byte (sha256= + 64 hex). 길이 패딩 후
    // timingSafeEqual 호출은 항상 mismatch 가 보장돼 무의미하고 zero-fill alloc 비용만 발생.
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new UnauthorizedException(`${headerName} 시그니처 불일치.`);
    }
  }
}
