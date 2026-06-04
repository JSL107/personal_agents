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
import { GenerateBeDiffUsecase } from '../../be-diff-generator/application/generate-be-diff.usecase';
import { isBeSandboxApplyPayload } from '../domain/be-sandbox.type';

// Slack 응답 안 diff 표시 cap — Slack 메시지 한도 (40k) 와 멀어지지 않게 보수적으로 cap.
// Phase 2a-3 부터는 sandbox 안에서 실제로 적용 + test 결과만 보여주므로 본 cap 의 의미가 줄어듦.
const DIFF_TAIL_LIMIT = 12_000;

// PreviewKind.BE_SANDBOX_APPLY 의 strategy.
// Phase 2a-1: payload validation + sandbox echo (scaffold).
// Phase 2a-2 (현 단계): payload validation + GenerateBeDiffUsecase → 사용자에게 diff 표시. 실제 코드 변경 X.
// Phase 2a-3: sandbox 안 git apply + pnpm install + pnpm test 추가, diff 검증 후 결과 반환.
@Injectable()
export class BeSandboxApplier implements PreviewApplier {
  readonly kind: PreviewKind = PREVIEW_KIND.BE_SANDBOX_APPLY;
  private readonly logger = new Logger(BeSandboxApplier.name);

  constructor(private readonly generateBeDiffUsecase: GenerateBeDiffUsecase) {}

  async apply(preview: PreviewAction): Promise<string> {
    if (!isBeSandboxApplyPayload(preview.payload)) {
      throw new PreviewActionException({
        code: PreviewActionErrorCode.NO_APPLIER_FOR_KIND,
        message:
          'BE_SANDBOX_APPLY payload 형식이 BeSandboxApplyPayload 와 맞지 않습니다.',
        status: DomainStatus.INTERNAL,
      });
    }

    const { planText, repoLabel, baseBranch } = preview.payload;

    // Phase 2a-2 — Claude 로 unified diff 합성. parser 가 file/hunk header + path safety 검증.
    const diffResult = await this.generateBeDiffUsecase.execute({
      planText,
      repoLabel,
      baseBranch,
    });

    this.logger.log(
      `BE sandbox apply (Phase 2a-2) — repo=${repoLabel} base=${baseBranch} files=${diffResult.changedFiles.length} diffBytes=${diffResult.diff.length}`,
    );

    const diffSnippet =
      diffResult.diff.length > DIFF_TAIL_LIMIT
        ? `${diffResult.diff.slice(0, DIFF_TAIL_LIMIT)}\n... (생략됨 — diff cap ${DIFF_TAIL_LIMIT} bytes)`
        : diffResult.diff;

    return [
      `🧪 *BE Sandbox Apply — Phase 2a-2 (diff 생성, apply 미실행)*`,
      '',
      `• 대상 repo: ${repoLabel}`,
      `• 베이스 브랜치: ${baseBranch}`,
      `• 변경 파일 (${diffResult.changedFiles.length}건): ${diffResult.changedFiles.join(', ')}`,
      '',
      `*Reasoning*`,
      diffResult.reasoning,
      '',
      `*Diff*`,
      '```diff',
      diffSnippet,
      '```',
      '',
      '_Phase 2a-2 — diff 만 생성, sandbox 적용 / 테스트 / PR 푸시 미실행._',
      '_Phase 2a-3 PR 에서 sandbox 안 git apply + pnpm test 추가 예정._',
    ].join('\n');
  }
}
