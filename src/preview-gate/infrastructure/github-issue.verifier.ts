import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../github/domain/port/github-client.port';
import { VerifiableArtifact } from '../domain/apply-result.type';
import {
  ResultVerifier,
  VerificationOutcome,
} from '../domain/port/result-verifier.port';

// github_issue artifact 검증 — applier 가 만들었다고 반환한 issue 번호를 issues.get 으로 재조회해
// 실제로 존재하는지 확인한다. getItemLifecycle 이 issues.get 경량 조회라 그대로 쓴다.
//
// 재조회 실패는 작업 실패로 단정하지 않는다 (GithubPrVerifier 와 같은 이유) — unverifiableReason 으로 분리.
@Injectable()
export class GithubIssueVerifier implements ResultVerifier {
  private readonly logger = new Logger(GithubIssueVerifier.name);

  constructor(
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
  ) {}

  supports(artifact: VerifiableArtifact): boolean {
    return artifact.type === 'github_issue';
  }

  async verify(artifact: VerifiableArtifact): Promise<VerificationOutcome> {
    if (artifact.type !== 'github_issue') {
      return {
        verified: false,
        detail: `지원하지 않는 artifact type 입니다`,
        unverifiableReason: `github_issue 가 아님`,
      };
    }
    const label = `Issue ${artifact.repo}#${artifact.issueNumber}`;
    try {
      await this.githubClient.getItemLifecycle({
        repo: artifact.repo,
        number: artifact.issueNumber,
      });
      return { verified: true, detail: `${label} 반영 확인` };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      // raw octokit 메시지는 logger 에만 — 사용자 노출 텍스트는 generic 으로.
      this.logger.warn(`${label} 재조회 검증 실패 (graceful): ${message}`);
      return {
        verified: false,
        detail: `${label} 반영 확인`,
        unverifiableReason: '재조회 중 일시적 오류 (수동 확인 권장)',
      };
    }
  }
}
