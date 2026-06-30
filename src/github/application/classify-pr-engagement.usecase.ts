import { Inject, Injectable } from '@nestjs/common';

import { classifyPullRequestEngagement } from '../domain/classify-pr-engagement';
import { GithubPullRequest } from '../domain/github.type';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../domain/port/github-client.port';
import { WaitingItem } from '../domain/pr-engagement.type';

export interface EngagementSplit {
  activePullRequests: GithubPullRequest[];
  waitingItems: WaitingItem[];
}

// assigned PR 을 신호 보강 → 결정론 분류 → ACTIVE(LLM 노출) / WAITING(대기 섹션) 으로 분리.
// signal 이 매칭 안 되는 PR(보강 캡 외 등)은 ACTIVE 로 보존.
@Injectable()
export class ClassifyPullRequestEngagementUsecase {
  constructor(
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
  ) {}

  async execute(pullRequests: GithubPullRequest[]): Promise<EngagementSplit> {
    if (pullRequests.length === 0) {
      return { activePullRequests: [], waitingItems: [] };
    }
    const signals =
      await this.githubClient.fetchPullRequestEngagement(pullRequests);
    const signalByKey = new Map(
      signals.map((s) => [`${s.repo}#${s.number}`, s]),
    );

    const activePullRequests: GithubPullRequest[] = [];
    const waitingItems: WaitingItem[] = [];

    for (const pr of pullRequests) {
      const signal = signalByKey.get(`${pr.repo}#${pr.number}`);
      if (!signal) {
        activePullRequests.push(pr);
        continue;
      }
      const classification = classifyPullRequestEngagement(signal);
      if (classification.state === 'WAITING') {
        waitingItems.push({
          title: pr.title,
          url: pr.url,
          reason: classification.reason,
        });
      } else {
        activePullRequests.push(pr);
      }
    }

    return { activePullRequests, waitingItems };
  }
}
