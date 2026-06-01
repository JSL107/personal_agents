import { getQueueToken } from '@nestjs/bullmq';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as crypto from 'crypto';

import {
  BE_FIX_QUEUE,
  BE_SRE_QUEUE,
  CODE_REVIEWER_QUEUE,
  IMPACT_REPORT_QUEUE,
} from '../domain/webhook.type';
import { WebhookController } from './webhook.controller';

describe('WebhookController', () => {
  let controller: WebhookController;
  // V3 audit B2 #4 / B3 P5 / B4 H-2 — fire-and-forget 이 BullMQ queue 로 전환됐으므로
  // controller 가 직접 호출하던 GenerateImpactReportUsecase 대신 queue.add 만 검증.
  const mockImpactQueue = { add: jest.fn() };
  const mockBeFixQueue = { add: jest.fn() };
  const mockBeSreQueue = { add: jest.fn() };
  const mockCodeReviewerQueue = { add: jest.fn() };
  const secret = 'test-secret';
  const githubSecret = 'gh-test-secret';
  const defaultSlackUser = 'U-default';
  // ownerLogin 가드 — 본인 PR 만 자동 review. 미설정 시 review 자체 비활성.
  let ownerLogin: string | undefined = 'me';

  const configValues = (): Record<string, string | undefined> => ({
    WEBHOOK_SECRET: secret,
    GITHUB_WEBHOOK_SECRET: githubSecret,
    GITHUB_WEBHOOK_DEFAULT_SLACK_USER_ID: defaultSlackUser,
    GITHUB_WEBHOOK_OWNER_LOGIN: ownerLogin,
  });

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        {
          provide: getQueueToken(IMPACT_REPORT_QUEUE),
          useValue: mockImpactQueue,
        },
        { provide: getQueueToken(BE_FIX_QUEUE), useValue: mockBeFixQueue },
        { provide: getQueueToken(BE_SRE_QUEUE), useValue: mockBeSreQueue },
        {
          provide: getQueueToken(CODE_REVIEWER_QUEUE),
          useValue: mockCodeReviewerQueue,
        },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => configValues()[key] },
        },
      ],
    }).compile();
    controller = module.get(WebhookController);
    mockImpactQueue.add.mockReset();
    mockImpactQueue.add.mockResolvedValue(undefined);
    mockBeFixQueue.add.mockReset();
    mockBeFixQueue.add.mockResolvedValue(undefined);
    mockBeSreQueue.add.mockReset();
    mockBeSreQueue.add.mockResolvedValue(undefined);
    mockCodeReviewerQueue.add.mockReset();
    mockCodeReviewerQueue.add.mockResolvedValue(undefined);
    ownerLogin = 'me';
  });

  const sign = (body: string, signingSecret: string = secret) => {
    const hmac = crypto.createHmac('sha256', signingSecret);
    hmac.update(body);
    return `sha256=${hmac.digest('hex')}`;
  };

  describe('POST /v1/agent/trigger (이대리 자체 포맷)', () => {
    it('유효한 시그니처 + issues.opened → impact report 트리거', async () => {
      const body = JSON.stringify({
        event: 'issues.opened',
        repo: 'foo/bar',
        data: { number: 1, title: 'bug', body: 'desc', url: 'http://x' },
        slackUserId: 'U1',
      });
      const result = await controller.trigger(body, sign(body));
      expect(result).toEqual({ accepted: true });
      // fire-and-forget queue.add — controller 가 enqueue 후 즉시 200 OK 반환.
      // microtask 가 한 번 돌아야 add() 가 호출되니 microtask 큐 flush.
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockImpactQueue.add).toHaveBeenCalled();
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
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockImpactQueue.add).not.toHaveBeenCalled();
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

    const checkRunFailedBody = JSON.stringify({
      action: 'completed',
      check_run: {
        id: 1,
        name: 'CI / build',
        status: 'completed',
        conclusion: 'failure',
        head_sha: 'abc123',
        html_url: 'https://github.com/foo/bar/runs/1',
        output: { title: 'Build failed', summary: '10 errors found' },
      },
      repository: { full_name: 'foo/bar' },
    });

    it('유효한 시그니처 + issues opened → default slackUserId 로 impact report', async () => {
      const result = await controller.github(
        issuesOpenedBody,
        sign(issuesOpenedBody, githubSecret),
        'issues',
        'delivery-uuid-1',
      );
      expect(result).toEqual({ accepted: true });
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockImpactQueue.add).toHaveBeenCalledWith(
        'webhook-impact-report',
        expect.objectContaining({
          slackUserId: defaultSlackUser,
          subject: expect.stringContaining('foo/bar #42'),
        }),
        expect.any(Object),
      );
    });

    it('pull_request.opened → impact-report 큐 + BE-FIX 큐 둘 다 add 호출', async () => {
      const result = await controller.github(
        prOpenedBody,
        sign(prOpenedBody, githubSecret),
        'pull_request',
        'delivery-uuid-2',
      );
      expect(result).toEqual({ accepted: true });
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockImpactQueue.add).toHaveBeenCalledWith(
        'webhook-impact-report',
        expect.objectContaining({
          slackUserId: defaultSlackUser,
          subject: expect.stringContaining('foo/bar #99'),
        }),
        expect.any(Object),
      );
      expect(mockBeFixQueue.add).toHaveBeenCalledWith(
        'webhook-be-fix',
        expect.objectContaining({
          prRef: 'foo/bar#99',
          slackUserId: defaultSlackUser,
        }),
        expect.any(Object),
      );
    });

    it('check_run.completed + failure → BE-SRE 큐에 add 호출', async () => {
      const result = await controller.github(
        checkRunFailedBody,
        sign(checkRunFailedBody, githubSecret),
        'check_run',
        'delivery-uuid-cr-fail',
      );
      expect(result).toEqual({ accepted: true });
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockBeSreQueue.add).toHaveBeenCalledWith(
        'webhook-be-sre',
        expect.objectContaining({
          slackUserId: defaultSlackUser,
          stackTrace: expect.stringContaining('CI / build'),
        }),
        expect.any(Object),
      );
      expect(mockImpactQueue.add).not.toHaveBeenCalled();
      expect(mockBeFixQueue.add).not.toHaveBeenCalled();
    });

    it('check_run.completed + success → 모든 큐 add 호출 안 됨 (200 OK 만)', async () => {
      const successBody = JSON.stringify({
        action: 'completed',
        check_run: {
          id: 2,
          name: 'CI / build',
          status: 'completed',
          conclusion: 'success',
          head_sha: 'def456',
          html_url: 'https://github.com/foo/bar/runs/2',
        },
        repository: { full_name: 'foo/bar' },
      });
      const result = await controller.github(
        successBody,
        sign(successBody, githubSecret),
        'check_run',
        'delivery-uuid-cr-success',
      );
      expect(result).toEqual({ accepted: true });
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockImpactQueue.add).not.toHaveBeenCalled();
      expect(mockBeFixQueue.add).not.toHaveBeenCalled();
      expect(mockBeSreQueue.add).not.toHaveBeenCalled();
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
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockImpactQueue.add).not.toHaveBeenCalled();
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
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockImpactQueue.add).not.toHaveBeenCalled();
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
          {
            provide: getQueueToken(IMPACT_REPORT_QUEUE),
            useValue: mockImpactQueue,
          },
          { provide: getQueueToken(BE_FIX_QUEUE), useValue: mockBeFixQueue },
          { provide: getQueueToken(BE_SRE_QUEUE), useValue: mockBeSreQueue },
          {
            provide: getQueueToken(CODE_REVIEWER_QUEUE),
            useValue: mockCodeReviewerQueue,
          },
          {
            provide: ConfigService,
            useValue: { get: (key: string) => limitedConfig[key] },
          },
        ],
      }).compile();
      limitedController = module.get(WebhookController);
      mockImpactQueue.add.mockReset();
      mockImpactQueue.add.mockResolvedValue(undefined);
      mockBeFixQueue.add.mockReset();
      mockBeFixQueue.add.mockResolvedValue(undefined);
      mockBeSreQueue.add.mockReset();
      mockBeSreQueue.add.mockResolvedValue(undefined);
      mockCodeReviewerQueue.add.mockReset();
      mockCodeReviewerQueue.add.mockResolvedValue(undefined);
    });

    it('issues.opened 수신했지만 DEFAULT slackUser 없음 → 200 accepted, 모든 자동 발화 X', async () => {
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
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockImpactQueue.add).not.toHaveBeenCalled();
      expect(mockBeFixQueue.add).not.toHaveBeenCalled();
      expect(mockBeSreQueue.add).not.toHaveBeenCalled();
    });

    it('pull_request.opened 수신했지만 DEFAULT slackUser 없음 → 200 accepted, 모든 자동 발화 X', async () => {
      const body = JSON.stringify({
        action: 'opened',
        pull_request: {
          number: 5,
          title: 'feat: new',
          body: '',
          html_url: 'https://github.com/foo/bar/pull/5',
        },
        repository: { full_name: 'foo/bar' },
      });
      const result = await limitedController.github(
        body,
        sign(body, githubSecret),
        'pull_request',
        'd-no-owner-pr',
      );
      expect(result).toEqual({ accepted: true });
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockImpactQueue.add).not.toHaveBeenCalled();
      expect(mockBeFixQueue.add).not.toHaveBeenCalled();
      expect(mockBeSreQueue.add).not.toHaveBeenCalled();
    });

    it('check_run.failure 수신했지만 DEFAULT slackUser 없음 → 200 accepted, BE-SRE 발화 X', async () => {
      const body = JSON.stringify({
        action: 'completed',
        check_run: {
          id: 3,
          name: 'CI',
          status: 'completed',
          conclusion: 'failure',
          head_sha: 'abc',
          html_url: 'https://github.com/foo/bar/runs/3',
        },
        repository: { full_name: 'foo/bar' },
      });
      const result = await limitedController.github(
        body,
        sign(body, githubSecret),
        'check_run',
        'd-no-owner-cr',
      );
      expect(result).toEqual({ accepted: true });
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockBeSreQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('pull_request.opened — code-reviewer 자동 발화 가드', () => {
    const buildPrBody = (user?: { login: string; type: string }) =>
      JSON.stringify({
        action: 'opened',
        pull_request: {
          number: 99,
          title: 'fix: handle null',
          body: 'closes #42',
          html_url: 'https://github.com/foo/bar/pull/99',
          ...(user ? { user } : {}),
        },
        repository: { full_name: 'foo/bar' },
      });

    it('owner login 일치 + user type=User → code-reviewer 큐 add', async () => {
      ownerLogin = 'me';
      const body = buildPrBody({ login: 'me', type: 'User' });
      await controller.github(
        body,
        sign(body, githubSecret),
        'pull_request',
        'd-cr-1',
      );
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockCodeReviewerQueue.add).toHaveBeenCalledWith(
        'webhook-code-review',
        expect.objectContaining({
          prRef: 'foo/bar#99',
          slackUserId: defaultSlackUser,
        }),
        expect.objectContaining({ jobId: 'codereview:foo/bar#99' }),
      );
    });

    it('user.type=Bot → code-reviewer skip (dependabot 등)', async () => {
      ownerLogin = 'me';
      const body = buildPrBody({ login: 'dependabot[bot]', type: 'Bot' });
      await controller.github(
        body,
        sign(body, githubSecret),
        'pull_request',
        'd-cr-2',
      );
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockCodeReviewerQueue.add).not.toHaveBeenCalled();
      // BE-FIX / impact-report 는 그대로 발화 (가드는 review 만).
      expect(mockBeFixQueue.add).toHaveBeenCalled();
      expect(mockImpactQueue.add).toHaveBeenCalled();
    });

    it('user.login 불일치 → code-reviewer skip (팀 PR)', async () => {
      ownerLogin = 'me';
      const body = buildPrBody({ login: 'someone-else', type: 'User' });
      await controller.github(
        body,
        sign(body, githubSecret),
        'pull_request',
        'd-cr-3',
      );
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockCodeReviewerQueue.add).not.toHaveBeenCalled();
      expect(mockBeFixQueue.add).toHaveBeenCalled();
    });

    it('user 필드 누락 → code-reviewer skip (안전 측 가드)', async () => {
      ownerLogin = 'me';
      const body = buildPrBody();
      await controller.github(
        body,
        sign(body, githubSecret),
        'pull_request',
        'd-cr-4',
      );
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockCodeReviewerQueue.add).not.toHaveBeenCalled();
    });

    it('GITHUB_WEBHOOK_OWNER_LOGIN 미설정 → code-reviewer 자동 발화 자체 비활성', async () => {
      ownerLogin = undefined;
      const body = buildPrBody({ login: 'me', type: 'User' });
      await controller.github(
        body,
        sign(body, githubSecret),
        'pull_request',
        'd-cr-5',
      );
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockCodeReviewerQueue.add).not.toHaveBeenCalled();
      // BE-FIX / impact-report 는 그대로 — 본 가드는 review 만 비활성화.
      expect(mockBeFixQueue.add).toHaveBeenCalled();
      expect(mockImpactQueue.add).toHaveBeenCalled();
    });
  });
});
