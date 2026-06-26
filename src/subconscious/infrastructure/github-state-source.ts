import { Inject, Injectable } from '@nestjs/common';

import { GITHUB_CLIENT_PORT } from '../../github/domain/port/github-client.port';
import type { GithubClientPort } from '../../github/domain/port/github-client.port';
import { StateSource } from '../domain/port/state-source.port';
import { StateSnapshot } from '../domain/subconscious.type';
import { buildSnapshot, sha } from './snapshot.util';

@Injectable()
export class GithubStateSource implements StateSource {
  readonly id = 'github';

  constructor(
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
  ) {}

  async fetchSnapshot(ownerSlackUserId: string): Promise<StateSnapshot> {
    // ownerSlackUserId is used by the engine for baseline keying; the GitHub
    // client uses the authenticated token (PAT) to resolve "my" tasks.
    void ownerSlackUserId;

    const assigned = await this.githubClient.listMyAssignedTasks();

    const issueItems = assigned.issues.map((issue) => ({
      key: `github:issue:${issue.repo}#${issue.number}`,
      fingerprint: sha(`${issue.title}|open|${issue.updatedAt}`),
      summary: issue.title,
    }));

    const prItems = assigned.pullRequests.map((pr) => ({
      key: `github:pr:${pr.repo}#${pr.number}`,
      fingerprint: sha(`${pr.title}|open|${pr.updatedAt}`),
      summary: pr.title,
    }));

    return buildSnapshot(this.id, [...issueItems, ...prItems]);
  }
}
