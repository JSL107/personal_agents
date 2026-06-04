import { Injectable, Logger } from '@nestjs/common';

import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { PreviewApplier } from '../../../preview-gate/domain/port/preview-applier.port';
import { PreviewActionException } from '../../../preview-gate/domain/preview-action.exception';
import {
  PREVIEW_KIND,
  PreviewAction,
  PreviewKind,
} from '../../../preview-gate/domain/preview-action.type';
import { PreviewActionErrorCode } from '../../../preview-gate/domain/preview-action-error-code.enum';
import {
  isBeSandboxPushPrPayload,
  parseRepoLabel,
} from '../domain/be-sandbox-push-pr.type';

// Slack 응답 안 diff 표시 cap — 본 단계는 scaffold 라 작아도 OK.
const DIFF_TAIL_LIMIT = 4_000;

// PreviewKind.BE_SANDBOX_PUSH_PR strategy.
// Phase 2b-1 (현 단계, scaffold): payload validation + 변경 사항 요약 응답. 실제 octokit 호출 X.
// Phase 2b-2: octokit `repos.getBranch` 로 base SHA → `git.createBlob` + `git.createTree`
//             + `git.createCommit` + `git.createRef` + `pulls.create` chain.
//             main 직접 push 절대 X — branch 명: `feat/idaeri-<slug>-<shortSha>`.
@Injectable()
export class BeSandboxPushPrApplier implements PreviewApplier {
  readonly kind: PreviewKind = PREVIEW_KIND.BE_SANDBOX_PUSH_PR;
  private readonly logger = new Logger(BeSandboxPushPrApplier.name);

  async apply(preview: PreviewAction): Promise<string> {
    if (!isBeSandboxPushPrPayload(preview.payload)) {
      throw new PreviewActionException({
        code: PreviewActionErrorCode.NO_APPLIER_FOR_KIND,
        message:
          'BE_SANDBOX_PUSH_PR payload 형식이 BeSandboxPushPrPayload 와 맞지 않습니다.',
        status: DomainStatus.INTERNAL,
      });
    }

    const { diff, reasoning, changedFiles, repoLabel, baseBranch } =
      preview.payload;
    const { owner, repo } = parseRepoLabel(repoLabel);

    this.logger.log(
      `BE sandbox push PR (Phase 2b-1 scaffold) — repo=${owner}/${repo} base=${baseBranch} files=${changedFiles.length}`,
    );

    const diffSnippet =
      diff.length > DIFF_TAIL_LIMIT
        ? `${diff.slice(0, DIFF_TAIL_LIMIT)}\n... (생략됨 — diff cap ${DIFF_TAIL_LIMIT} bytes)`
        : diff;

    return [
      `🚀 *BE Sandbox Push PR — Phase 2b-1 scaffold*`,
      '',
      `• 대상 repo: ${owner}/${repo}`,
      `• 베이스 브랜치: ${baseBranch}`,
      `• 변경 파일 (${changedFiles.length}건): ${changedFiles.join(', ')}`,
      '',
      `*Reasoning*`,
      reasoning,
      '',
      `*Diff*`,
      '```diff',
      diffSnippet,
      '```',
      '',
      '_Phase 2b-1 — payload validation 까지만. Phase 2b-2 에서 octokit 으로 새 branch + commit + PR open 추가 예정. main 직접 push 절대 X._',
    ].join('\n');
  }
}
