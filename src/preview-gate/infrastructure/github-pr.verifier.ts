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

// github_pr artifact 검증 — applier 가 PR 을 열었다고 반환한 prNumber 를 getPullRequest 로
// 재조회해 실제로 존재하는지 확인한다. 가장 위험한 외부 부작용(코드 push + PR open)이므로
// "API 가 throw 안 했으니 성공" 을 넘어 실제 반영을 한 번 더 확인.
//
// 재조회가 throw 하면 작업이 실패했다고 단정하지 않는다 (PR 은 열렸는데 일시적 네트워크/eventual
// consistency 로 조회만 실패했을 수 있음) — verified=false 이되 unverifiableReason 으로 분리해
// 사용자에게는 "확인 불가 — 수동 확인" 으로 안내한다.
@Injectable()
export class GithubPrVerifier implements ResultVerifier {
  private readonly logger = new Logger(GithubPrVerifier.name);

  constructor(
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
  ) {}

  supports(artifact: VerifiableArtifact): boolean {
    return artifact.type === 'github_pr';
  }

  async verify(artifact: VerifiableArtifact): Promise<VerificationOutcome> {
    if (artifact.type !== 'github_pr') {
      return {
        verified: false,
        detail: `지원하지 않는 artifact type 입니다`,
        unverifiableReason: `github_pr 가 아님`,
      };
    }
    const label = `PR ${artifact.repo}#${artifact.prNumber}`;
    try {
      await this.githubClient.getPullRequest({
        repo: artifact.repo,
        number: artifact.prNumber,
      });
      return { verified: true, detail: `${label} 반영 확인` };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      // raw octokit 메시지(HTTP status / URL / 응답 본문)는 logger 에만 — 사용자 노출 텍스트는
      // generic 으로 (toUserFacingErrorMessage 의 내부 정보 마스킹 정책과 일관).
      this.logger.warn(`${label} 재조회 검증 실패 (graceful): ${message}`);
      return {
        verified: false,
        detail: `${label} 반영 확인`,
        unverifiableReason: '재조회 중 일시적 오류 (수동 확인 권장)',
      };
    }
  }
}
