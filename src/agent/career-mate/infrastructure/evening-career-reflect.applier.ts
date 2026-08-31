import { Injectable, Logger } from '@nestjs/common';

import { ApplyResult } from '../../../preview-gate/domain/apply-result.type';
import { PreviewApplier } from '../../../preview-gate/domain/port/preview-applier.port';
import {
  PREVIEW_KIND,
  PreviewAction,
} from '../../../preview-gate/domain/preview-action.type';
import { ReflectPrUsecase } from '../application/reflect-pr.usecase';

interface EveningCareerPayload {
  // 저장소별로 나뉜 PR 묶음. 묶음 하나가 회고 1회 = 성과 1건이 된다.
  prGroups?: string[][];
  // 그룹 도입(2026-08-31) 이전에 만들어져 아직 승인되지 않은 카드가 쓰는 형태.
  prRefs?: string[];
  slackUserId: string;
}

@Injectable()
export class EveningCareerReflectApplier implements PreviewApplier {
  readonly kind = PREVIEW_KIND.EVENING_CAREER_REFLECT;
  private readonly logger = new Logger(EveningCareerReflectApplier.name);

  constructor(private readonly reflectPr: ReflectPrUsecase) {}

  async apply(preview: PreviewAction): Promise<ApplyResult> {
    const payload = preview.payload as EveningCareerPayload;
    const groups = this.resolveGroups(payload);
    if (groups.length === 0) {
      throw new Error('EVENING_CAREER_REFLECT: payload.prGroups/prRefs 누락');
    }

    // 순차 실행이어야 한다 — ReflectPrUsecase 는 "최신 프로필 조회 → 병합 → 저장" 이라
    // 병렬로 돌리면 뒤에 저장한 회차가 앞 회차의 성과를 덮어쓴다(lost update).
    const messages: string[] = [];
    const failedGroups: string[][] = [];
    let lastPortfolioUrl: string | null = null;
    for (const refs of groups) {
      try {
        const outcome = await this.reflectPr.execute({
          slackUserId: payload.slackUserId,
          prText: refs.join('\n'),
        });
        lastPortfolioUrl = outcome.result.portfolioUrl ?? lastPortfolioUrl;
        messages.push(`${this.repoOf(refs)} ${refs.length}건`);
      } catch (error) {
        // 그룹 하나가 실패해도 나머지는 반영한다 — 한 저장소의 PR 접근 실패로 그날 성과가
        // 통째로 사라지면, 승인 카드는 이미 소비돼 다시 누를 수 없다.
        failedGroups.push(refs);
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `EVENING_CAREER_REFLECT 그룹 실패 — ${this.repoOf(refs)}: ${message}`,
        );
      }
    }

    if (messages.length === 0) {
      throw new Error(
        `EVENING_CAREER_REFLECT: ${groups.length}개 묶음이 모두 실패했습니다.`,
      );
    }
    // 실패한 묶음은 PR 참조를 그대로 돌려준다. 카드는 한 번 소비되면 다시 누를 수 없어
    // 사람이 손으로 회고를 다시 요청해야 하는데, 저장소 이름만으로는 무엇을 다시 돌릴지
    // 알 수 없다 — 일시적인 GitHub 호출 실패가 성과의 영구 누락이 된다.
    const failedNote =
      failedGroups.length > 0
        ? `\\n⚠️ 반영 실패 ${failedGroups.length}묶음 — 아래 PR 로 다시 요청해주세요:\\n${failedGroups
            .map((refs) => `• ${refs.join(' ')}`)
            .join('\\n')}`
        : '';
    return {
      message: `이력서/포트폴리오에 반영했습니다 (${messages.join(', ')})${failedNote} — ${lastPortfolioUrl ?? '완료'}`,
      artifacts: [],
    };
  }

  private resolveGroups(payload: EveningCareerPayload): string[][] {
    const grouped = (payload?.prGroups ?? []).filter((refs) => refs.length > 0);
    if (grouped.length > 0) {
      return grouped;
    }
    const legacy = payload?.prRefs ?? [];
    return legacy.length > 0 ? [legacy] : [];
  }

  private repoOf(refs: string[]): string {
    return refs[0]?.split('#')[0] ?? '(알 수 없음)';
  }
}
