import { Injectable, Logger } from '@nestjs/common';

import { ApplyResult } from '../../../preview-gate/domain/apply-result.type';
import { PreviewApplier } from '../../../preview-gate/domain/port/preview-applier.port';
import {
  PREVIEW_KIND,
  PreviewAction,
} from '../../../preview-gate/domain/preview-action.type';
import { ReflectPrUsecase } from '../application/reflect-pr.usecase';
import {
  careerGroupRepo,
  EveningCareerPayload,
  readImpactContext,
  resolveCareerPrGroups,
} from '../domain/evening-career-payload';

@Injectable()
export class EveningCareerReflectApplier implements PreviewApplier {
  readonly kind = PREVIEW_KIND.EVENING_CAREER_REFLECT;
  private readonly logger = new Logger(EveningCareerReflectApplier.name);

  constructor(private readonly reflectPr: ReflectPrUsecase) {}

  async apply(preview: PreviewAction): Promise<ApplyResult> {
    const payload = preview.payload as EveningCareerPayload;
    const groups = resolveCareerPrGroups(payload);
    if (groups.length === 0) {
      throw new Error('EVENING_CAREER_REFLECT: payload.prGroups/prRefs 누락');
    }

    // 순차 실행이어야 한다 — ReflectPrUsecase 는 "최신 프로필 조회 → 병합 → 저장" 이라
    // 병렬로 돌리면 뒤에 저장한 회차가 앞 회차의 성과를 덮어쓴다(lost update).
    const messages: string[] = [];
    const failedGroups: string[][] = [];
    let lastPortfolioUrl: string | null = null;
    for (const [index, refs] of groups.entries()) {
      // 맥락은 묶음마다 따로 받는다 — 카드 전체에 한 줄만 받으면 회사 저장소의 수치가
      // 개인 프로젝트 성과에도 실린다.
      const impactContext = readImpactContext(payload, index);
      try {
        const outcome = await this.reflectPr.execute({
          slackUserId: payload.slackUserId,
          prText: refs.join('\n'),
          ...(impactContext ? { impactContext } : {}),
        });
        lastPortfolioUrl = outcome.result.portfolioUrl ?? lastPortfolioUrl;
        // 맥락이 실렸는지를 결과 문구에 남긴다. 입력칸은 승인과 함께 사라지므로, 여기서
        // 말하지 않으면 "적은 게 반영됐는지" 를 확인할 화면이 어디에도 없다.
        messages.push(
          `${careerGroupRepo(refs)} ${refs.length}건${impactContext ? '(맥락 반영)' : ''}`,
        );
      } catch (error) {
        // 그룹 하나가 실패해도 나머지는 반영한다 — 한 저장소의 PR 접근 실패로 그날 성과가
        // 통째로 사라지면, 승인 카드는 이미 소비돼 다시 누를 수 없다.
        failedGroups.push(refs);
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `EVENING_CAREER_REFLECT 그룹 실패 — ${careerGroupRepo(refs)}: ${message}`,
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
}
