import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as crypto from 'crypto';

import { GenerateImpactReportUsecase } from '../../agent/impact-reporter/application/generate-impact-report.usecase';
import { WebhookController } from './webhook.controller';

describe('WebhookController', () => {
  let controller: WebhookController;
  const mockUsecase = { execute: jest.fn() };
  const secret = 'test-secret';

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        { provide: GenerateImpactReportUsecase, useValue: mockUsecase },
        { provide: ConfigService, useValue: { get: () => secret } },
      ],
    }).compile();
    controller = module.get(WebhookController);
    mockUsecase.execute.mockReset();
  });

  const sign = (body: string) => {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(body);
    return `sha256=${hmac.digest('hex')}`;
  };

  it('유효한 시그니처 + issues.opened → impact report 트리거', async () => {
    mockUsecase.execute.mockResolvedValue({
      result: {},
      modelUsed: 'test',
      agentRunId: 1,
    });
    const body = JSON.stringify({
      event: 'issues.opened',
      repo: 'foo/bar',
      data: { number: 1, title: 'bug', body: 'desc', url: 'http://x' },
      slackUserId: 'U1',
    });
    const result = await controller.trigger(body, sign(body));
    expect(result).toEqual({ accepted: true });
    expect(mockUsecase.execute).toHaveBeenCalled();
  });

  it('잘못된 시그니처 → 401', async () => {
    const body = JSON.stringify({
      event: 'issues.opened',
      repo: 'foo/bar',
      data: {},
      slackUserId: 'U1',
    });
    await expect(controller.trigger(body, 'sha256=bad')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('서명 헤더 누락 → 401', async () => {
    const body = JSON.stringify({
      event: 'issues.opened',
      repo: 'foo/bar',
      data: {},
      slackUserId: 'U1',
    });
    await expect(controller.trigger(body, '')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('알 수 없는 event → 200 accepted (no-op)', async () => {
    const body = JSON.stringify({
      event: 'push',
      repo: 'foo/bar',
      data: {},
      slackUserId: 'U1',
    });
    const result = await controller.trigger(body, sign(body));
    expect(result).toEqual({ accepted: true });
    expect(mockUsecase.execute).not.toHaveBeenCalled();
  });
});
