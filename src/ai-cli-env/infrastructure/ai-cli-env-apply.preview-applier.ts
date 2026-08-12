import { Inject, Injectable } from '@nestjs/common';

import { ApplyResult } from '../../preview-gate/domain/apply-result.type';
import { PreviewApplier } from '../../preview-gate/domain/port/preview-applier.port';
import {
  PREVIEW_KIND,
  PreviewAction,
} from '../../preview-gate/domain/preview-action.type';
import { AiCliEnvApplyPayload } from '../domain/ai-cli-env.type';
import { AI_CLI_ENV_PORT, AiCliEnvPort } from '../domain/port/ai-cli-env.port';

@Injectable()
export class AiCliEnvApplyPreviewApplier implements PreviewApplier {
  readonly kind = PREVIEW_KIND.AI_CLI_ENV_APPLY;

  constructor(@Inject(AI_CLI_ENV_PORT) private readonly port: AiCliEnvPort) {}

  async apply(preview: PreviewAction): Promise<ApplyResult> {
    const payload = preview.payload as Partial<AiCliEnvApplyPayload>;
    if (typeof payload.snapshotSha !== 'string' || !payload.snapshotSha) {
      throw new Error(
        'AI CLI 환경 복원 preview payload 에 snapshotSha가 없습니다.',
      );
    }
    const result = await this.port.applySnapshot(payload.snapshotSha);
    const warningMessage = result.warnings.length
      ? `\n\n⚠️ 주의 ${result.warnings.length}건:\n${result.warnings.map((warning) => `- ${warning}`).join('\n')}`
      : '';
    return {
      message: `✅ AI CLI 환경 스냅샷 ${result.appliedSha}를 적용했습니다.${warningMessage}`,
      artifacts: [],
    };
  }
}
