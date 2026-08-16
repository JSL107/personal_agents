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

@Injectable()
export class GithubFileVerifier implements ResultVerifier {
  private readonly logger = new Logger(GithubFileVerifier.name);

  constructor(
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
  ) {}

  supports(artifact: VerifiableArtifact): boolean {
    return artifact.type === 'github_file';
  }

  async verify(artifact: VerifiableArtifact): Promise<VerificationOutcome> {
    if (artifact.type !== 'github_file') {
      return {
        verified: false,
        detail: '지원하지 않는 artifact type 입니다',
        unverifiableReason: 'github_file 이 아님',
      };
    }
    const label = `파일 ${artifact.repo}@${artifact.branch}:${artifact.path}`;
    try {
      await this.githubClient.getFileFromBranch({
        repo: artifact.repo,
        branch: artifact.branch,
        path: artifact.path,
      });
      return { verified: true, detail: `${label} 반영 확인` };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`${label} 재조회 검증 실패 (graceful): ${message}`);
      return {
        verified: false,
        detail: `${label} 반영 확인`,
        unverifiableReason: '재조회 중 일시적 오류 (수동 확인 권장)',
      };
    }
  }
}
