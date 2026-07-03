import { Injectable } from '@nestjs/common';

import { ApplyResult } from '../../../preview-gate/domain/apply-result.type';
import { PreviewApplier } from '../../../preview-gate/domain/port/preview-applier.port';
import {
  PREVIEW_KIND,
  PreviewAction,
} from '../../../preview-gate/domain/preview-action.type';
import { ReflectPrUsecase } from '../application/reflect-pr.usecase';

interface EveningCareerPayload {
  prRefs: string[];
  slackUserId: string;
}

@Injectable()
export class EveningCareerReflectApplier implements PreviewApplier {
  readonly kind = PREVIEW_KIND.EVENING_CAREER_REFLECT;

  constructor(private readonly reflectPr: ReflectPrUsecase) {}

  async apply(preview: PreviewAction): Promise<ApplyResult> {
    const payload = preview.payload as EveningCareerPayload;
    if (!payload?.prRefs?.length) {
      throw new Error('EVENING_CAREER_REFLECT: payload.prRefs 누락');
    }
    const outcome = await this.reflectPr.execute({
      slackUserId: payload.slackUserId,
      prText: payload.prRefs.join('\n'),
    });
    return {
      message: `이력서/포트폴리오에 반영했습니다 (PR ${payload.prRefs.length}건) — ${outcome.result.portfolioUrl ?? '완료'}`,
      artifacts: [],
    };
  }
}
