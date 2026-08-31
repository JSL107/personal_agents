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
    const failedRepositories: string[] = [];
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
        failedRepositories.push(this.repoOf(refs));
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
    // 실패한 저장소를 이름으로 남긴다 — 건수만 알려주면 어느 성과가 빠졌는지 알 수 없고,
    // 카드는 이미 소비돼 다시 누를 수 없다.
    const failedNote =
      failedRepositories.length > 0
        ? ` · 실패: ${failedRepositories.join(', ')} (로그 참고)`
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
