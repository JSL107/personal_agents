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
  const githubSecret = 'gh-test-secret';
  const defaultSlackUser = 'U-default';

  const configValues: Record<string, string> = {
    WEBHOOK_SECRET: secret,
    GITHUB_WEBHOOK_SECRET: githubSecret,
    GITHUB_WEBHOOK_DEFAULT_SLACK_USER_ID: defaultSlackUser,
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        { provide: GenerateImpactReportUsecase, useValue: mockUsecase },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => configValues[key] },
        },
      ],
    }).compile();
    controller = module.get(WebhookController);
    mockUsecase.execute.mockReset();
  });

  const sign = (body: string, signingSecret: string = secret) => {
    const hmac = crypto.createHmac('sha256', signingSecret);
    hmac.update(body);
    return `sha256=${hmac.digest('hex')}`;
  };

  describe('POST /v1/agent/trigger (이대리 자체 포맷)', () => {
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

  describe('POST /v1/agent/github (GitHub 표준 포맷)', () => {
    const issuesOpenedBody = JSON.stringify({
      action: 'opened',
      issue: {
        number: 42,
        title: 'crash on login',
        body: 'reproduces on staging',
        html_url: 'https://github.com/foo/bar/issues/42',
      },
      repository: { full_name: 'foo/bar' },
    });

    const prOpenedBody = JSON.stringify({
      action: 'opened',
      pull_request: {
        number: 99,
        title: 'fix: handle null',
        body: 'closes #42',
        html_url: 'https://github.com/foo/bar/pull/99',
      },
      repository: { full_name: 'foo/bar' },
    });

    it('유효한 시그니처 + issues opened → default slackUserId 로 impact report', async () => {
      mockUsecase.execute.mockResolvedValue({
        result: {},
        modelUsed: 'test',
        agentRunId: 1,
      });
      const result = await controller.github(
        issuesOpenedBody,
        sign(issuesOpenedBody, githubSecret),
        'issues',
        'delivery-uuid-1',
      );
      expect(result).toEqual({ accepted: true });
      expect(mockUsecase.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          slackUserId: defaultSlackUser,
          subject: expect.stringContaining('foo/bar #42'),
        }),
      );
    });

    it('유효한 시그니처 + pull_request opened → impact report', async () => {
      mockUsecase.execute.mockResolvedValue({
        result: {},
        modelUsed: 'test',
        agentRunId: 1,
      });
      const result = await controller.github(
        prOpenedBody,
        sign(prOpenedBody, githubSecret),
        'pull_request',
        'delivery-uuid-2',
      );
      expect(result).toEqual({ accepted: true });
      expect(mockUsecase.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          slackUserId: defaultSlackUser,
          subject: expect.stringContaining('foo/bar #99'),
        }),
      );
    });

    it('잘못된 시그니처 → 401', async () => {
      await expect(
        controller.github(
          issuesOpenedBody,
          'sha256=bad',
          'issues',
          'delivery-uuid-3',
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('X-GitHub-Event 헤더 누락 → 401', async () => {
      await expect(
        controller.github(
          issuesOpenedBody,
          sign(issuesOpenedBody, githubSecret),
          '',
          'delivery-uuid-4',
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('issues closed (action=opened 아님) → 200 no-op', async () => {
      const body = JSON.stringify({
        action: 'closed',
        issue: { number: 1, title: 't', body: '', html_url: '' },
        repository: { full_name: 'foo/bar' },
      });
      const result = await controller.github(
        body,
        sign(body, githubSecret),
        'issues',
        'd5',
      );
      expect(result).toEqual({ accepted: true });
      expect(mockUsecase.execute).not.toHaveBeenCalled();
    });

    it('지원 안 하는 event(push) → 200 no-op', async () => {
      const body = JSON.stringify({ ref: 'refs/heads/main' });
      const result = await controller.github(
        body,
        sign(body, githubSecret),
        'push',
        'd6',
      );
      expect(result).toEqual({ accepted: true });
      expect(mockUsecase.execute).not.toHaveBeenCalled();
    });
  });

  describe('POST /v1/agent/github — DEFAULT_SLACK_USER_ID 미설정', () => {
    let limitedController: WebhookController;
    const limitedConfig: Record<string, string> = {
      WEBHOOK_SECRET: secret,
      GITHUB_WEBHOOK_SECRET: githubSecret,
      // GITHUB_WEBHOOK_DEFAULT_SLACK_USER_ID 누락
    };

    beforeEach(async () => {
      const module = await Test.createTestingModule({
        controllers: [WebhookController],
        providers: [
          { provide: GenerateImpactReportUsecase, useValue: mockUsecase },
          {
            provide: ConfigService,
            useValue: { get: (key: string) => limitedConfig[key] },
          },
        ],
      }).compile();
      limitedController = module.get(WebhookController);
      mockUsecase.execute.mockReset();
    });

    it('issues.opened 수신했지만 DEFAULT slackUser 없음 → 200 accepted, impact report 발화 X', async () => {
      const body = JSON.stringify({
        action: 'opened',
        issue: { number: 1, title: 't', body: '', html_url: '' },
        repository: { full_name: 'foo/bar' },
      });
      const result = await limitedController.github(
        body,
        sign(body, githubSecret),
        'issues',
        'd-no-owner',
      );
      expect(result).toEqual({ accepted: true });
      expect(mockUsecase.execute).not.toHaveBeenCalled();
    });
  });
});
