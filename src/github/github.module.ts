import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from '@octokit/rest';

import { ClassifyPullRequestEngagementUsecase } from './application/classify-pr-engagement.usecase';
import { ListAssignedTasksUsecase } from './application/list-assigned-tasks.usecase';
import {
  GITHUB_CLIENT_PORT,
  GITHUB_REVIEW_BOT_CLIENT,
  GithubClientPort,
  OCTOKIT_INSTANCE,
} from './domain/port/github-client.port';
import {
  fetchWithTimeout,
  GITHUB_REQUEST_TIMEOUT_MS,
} from './infrastructure/fetch-with-timeout';
import { OctokitGithubClient } from './infrastructure/octokit-github.client';

const createOctokit = (token: string): Octokit =>
  new Octokit({
    auth: token,
    // 상한이 없으면 응답 없는 한 요청이 이 클라이언트를 쓰는 AgentRun 을 무기한 붙잡는다.
    request: {
      fetch: fetchWithTimeout(GITHUB_REQUEST_TIMEOUT_MS),
    },
  });

@Module({
  providers: [
    ListAssignedTasksUsecase,
    ClassifyPullRequestEngagementUsecase,
    {
      // Octokit 인스턴스를 factory 로 주입 — 테스트 시 mock 으로 교체 가능.
      // GITHUB_TOKEN 이 없으면 null 을 주입하고, OctokitGithubClient 가 호출 시점에 친절한 예외를 던진다.
      provide: OCTOKIT_INSTANCE,
      useFactory: (configService: ConfigService): Octokit | null => {
        const token = configService.get<string>('GITHUB_TOKEN');
        if (!token) {
          return null;
        }
        return createOctokit(token);
      },
      inject: [ConfigService],
    },
    {
      provide: GITHUB_CLIENT_PORT,
      useClass: OctokitGithubClient,
    },
    {
      provide: GITHUB_REVIEW_BOT_CLIENT,
      useFactory: (configService: ConfigService): GithubClientPort | null => {
        const token = configService.get<string>('GITHUB_REVIEW_BOT_TOKEN');
        if (!token) {
          return null;
        }
        return new OctokitGithubClient(createOctokit(token));
      },
      inject: [ConfigService],
    },
  ],
  // ReviewPullRequestUsecase / GenerateImpactReportUsecase 등 외부 모듈이
  // GithubClientPort 를 직접 주입받기 때문에 토큰까지 함께 export.
  exports: [
    ListAssignedTasksUsecase,
    ClassifyPullRequestEngagementUsecase,
    GITHUB_CLIENT_PORT,
    GITHUB_REVIEW_BOT_CLIENT,
  ],
})
export class GithubModule {}
