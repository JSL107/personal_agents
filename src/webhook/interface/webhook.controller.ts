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
  WEBHOOK_SECRET_ENV,
  WebhookTriggerPayload,
} from '../domain/webhook.type';

// OPS-2 단일 Webhook 수신부.
// GitHub webhook (issues.opened, pull_request.opened) → /impact-report 자동 트리거.
// HMAC-SHA256 시그니처 검증 (X-Webhook-Signature: sha256=<hex>).
// WEBHOOK_SECRET 미설정 시 모든 요청 거부 (운영 안전 원칙).
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
    this.verifySignature(rawBody, signature);

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
      // fire-and-forget — webhook response 는 빠르게 200, 실제 작업은 비동기.
      void this.generateImpactReportUsecase
        .execute({ subject, slackUserId: payload.slackUserId })
        .catch((err: unknown) => {
          this.logger.error(
            `Webhook impact report 실패: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }

    return { accepted: true };
  }

  private verifySignature(rawBody: string, signature: string): void {
    const secret = this.configService.get<string>(WEBHOOK_SECRET_ENV);
    if (!secret) {
      throw new UnauthorizedException(
        'WEBHOOK_SECRET 미설정 — 모든 webhook 요청을 거부합니다.',
      );
    }
    if (!signature?.startsWith('sha256=')) {
      throw new UnauthorizedException(
        'X-Webhook-Signature 헤더가 없거나 형식이 잘못됐습니다.',
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
      throw new UnauthorizedException('HMAC 시그니처 불일치.');
    }
  }
}
