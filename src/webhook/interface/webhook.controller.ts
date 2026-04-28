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
import * as crypto from 'crypto';

import { GenerateImpactReportUsecase } from '../../agent/impact-reporter/application/generate-impact-report.usecase';
import {
  GITHUB_DELIVERY_HEADER,
  GITHUB_EVENT_HEADER,
  GITHUB_SIGNATURE_HEADER,
  GITHUB_WEBHOOK_OWNER_ENV,
  GITHUB_WEBHOOK_SECRET_ENV,
  GithubIssuesEvent,
  GithubPullRequestEvent,
  GithubWebhookPayload,
} from '../domain/github-webhook.type';
import {
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
    private readonly generateImpactReportUsecase: GenerateImpactReportUsecase,
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

    const subject = this.toImpactSubject({ event, payload });
    if (!subject) {
      // 지원하지 않는 event/action — accept 하되 작업 발화 X (재시도 폭주 방지).
      return { accepted: true };
    }

    const slackUserId = this.configService.get<string>(
      GITHUB_WEBHOOK_OWNER_ENV,
    );
    if (!slackUserId || slackUserId.trim().length === 0) {
      this.logger.warn(
        'GITHUB_WEBHOOK_DEFAULT_SLACK_USER_ID 미설정 — impact-report 자동 발화 생략 (수신 자체는 200 OK).',
      );
      return { accepted: true };
    }

    this.fireImpactReport({ subject, slackUserId });
    return { accepted: true };
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

  private fireImpactReport({
    subject,
    slackUserId,
  }: {
    subject: string;
    slackUserId: string;
  }): void {
    // fire-and-forget — webhook response 는 빠르게 200, 실제 작업은 비동기.
    void this.generateImpactReportUsecase
      .execute({ subject, slackUserId })
      .catch((err: unknown) => {
        this.logger.error(
          `Webhook impact report 실패: ${err instanceof Error ? err.message : String(err)}`,
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
      throw new UnauthorizedException(
        `${secretEnv} 미설정 — 모든 ${headerName} 요청을 거부합니다.`,
      );
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
    const len = Math.max(a.length, b.length);
    const pa = Buffer.alloc(len, 0);
    const pb = Buffer.alloc(len, 0);
    a.copy(pa);
    b.copy(pb);
    if (!crypto.timingSafeEqual(pa, pb)) {
      throw new UnauthorizedException(`${headerName} 시그니처 불일치.`);
    }
  }
}
