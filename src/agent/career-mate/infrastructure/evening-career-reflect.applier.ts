import { Injectable, Logger } from '@nestjs/common';

import { ApplyResult } from '../../../preview-gate/domain/apply-result.type';
import {
  ApplyProgress,
  PreviewApplier,
} from '../../../preview-gate/domain/port/preview-applier.port';
import {
  PREVIEW_KIND,
  PreviewAction,
} from '../../../preview-gate/domain/preview-action.type';
import { ReflectPrUsecase } from '../application/reflect-pr.usecase';
import { RenderPortfolioUsecase } from '../application/render-portfolio.usecase';
import {
  careerGroupRepo,
  careerGroupStepKey,
  EveningCareerPayload,
  readImpactContext,
  resolveCareerPrGroups,
} from '../domain/evening-career-payload';

@Injectable()
export class EveningCareerReflectApplier implements PreviewApplier {
  readonly kind = PREVIEW_KIND.EVENING_CAREER_REFLECT;
  // 묶음 하나가 끝날 때마다 원장에 기록하므로 중단된 뒤 이어서 돌릴 수 있다.
  //
  // 이 플래그가 없던 동안 재시작은 승인 전체를 처음부터 다시 돌게 만들었다. `ReflectPrUsecase`
  // 는 "조회 → 병합 → 저장" 이라 멱등이 아니어서, 이미 반영된 묶음이 프로필에 두 번 들어갔다
  // (2026-09-23 실측).
  readonly resumable = true;
  private readonly logger = new Logger(EveningCareerReflectApplier.name);

  constructor(
    private readonly reflectPr: ReflectPrUsecase,
    private readonly renderPortfolio: RenderPortfolioUsecase,
  ) {}

  async apply(
    preview: PreviewAction,
    progress?: ApplyProgress,
  ): Promise<ApplyResult> {
    const payload = preview.payload as EveningCareerPayload;
    const groups = resolveCareerPrGroups(payload);
    if (groups.length === 0) {
      throw new Error('EVENING_CAREER_REFLECT: payload.prGroups/prRefs 누락');
    }

    // 중단 전에 이미 끝난 묶음. `progress` 가 없으면(단위 테스트·옛 호출부) 빈 집합이라
    // 종전처럼 전부 실행한다.
    const alreadyDone = new Set(progress?.done ?? []);

    // 순차 실행이어야 한다 — ReflectPrUsecase 는 "최신 프로필 조회 → 병합 → 저장" 이라
    // 병렬로 돌리면 뒤에 저장한 회차가 앞 회차의 성과를 덮어쓴다(lost update).
    const messages: string[] = [];
    const failedGroups: FailedGroup[] = [];
    for (const [index, refs] of groups.entries()) {
      const stepKey = careerGroupStepKey(index, refs);
      // 이미 반영된 묶음은 건너뛴다. 이것이 재개의 전부다 — 건너뛰지 않으면 재개가 중복 반영이
      // 되어 애초에 막으려던 사고를 그대로 다시 낸다.
      if (alreadyDone.has(stepKey)) {
        messages.push(`${careerGroupRepo(refs)} ${refs.length}건(이미 반영됨)`);
        continue;
      }
      // 맥락은 묶음마다 따로 받는다 — 카드 전체에 한 줄만 받으면 회사 저장소의 수치가
      // 개인 프로젝트 성과에도 실린다.
      const impactContext = readImpactContext(payload, index);
      try {
        await this.reflectPr.execute({
          slackUserId: payload.slackUserId,
          prText: refs.join('\n'),
          ...(impactContext ? { impactContext } : {}),
          // 묶음마다 포트폴리오를 건드리지 않는다. 포트폴리오는 페이지를 통째로 다시 쓰므로
          // 묶음 N건이면 (N-1)번이 다음 묶음에 덮여 사라지는 순수 낭비다 — 실측 카드가
          // 2~5묶음(중앙값 3)이라 회차당 수백 초를 그렇게 썼다. 루프 뒤에 한 번만 반영한다.
          portfolioSync: 'skip',
        });
        // 다음 묶음으로 넘어가기 **전에** 기록한다. 기록이 뒤로 밀리면 그 사이에 죽었을 때
        // 끝난 묶음이 안 끝난 것으로 남아 재개가 다시 반영한다.
        //
        // 포트폴리오 반영은 이 기록에 들어가지 않는다 — 루프 뒤에 한 번만 돌고, 페이지를
        // 통째로 다시 쓰므로 재개가 그것을 한 번 더 실행해도 결과가 같다. 재개가 건너뛰어야
        // 하는 것은 비멱등인 묶음별 회고(`ReflectPrUsecase`) 쪽이다.
        await progress?.record(stepKey);
        // 맥락이 실렸는지를 결과 문구에 남긴다. 입력칸은 승인과 함께 사라지므로, 여기서
        // 말하지 않으면 "적은 게 반영됐는지" 를 확인할 화면이 어디에도 없다.
        messages.push(
          `${careerGroupRepo(refs)} ${refs.length}건${impactContext ? '(맥락 반영)' : ''}`,
        );
      } catch (error) {
        // 그룹 하나가 실패해도 나머지는 반영한다 — 한 저장소의 PR 접근 실패로 그날 성과가
        // 통째로 사라지면, 승인 카드는 이미 소비돼 다시 누를 수 없다.
        failedGroups.push({ refs, impactContext });
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

    // 성공한 묶음이 하나라도 있을 때 포트폴리오를 한 번 반영한다. 끝까지 기다리는 이유는
    // 아래 문구가 "반영했습니다" 로 단정하고, 승인 카드가 일회성이라 다시 누를 수 없기
    // 때문이다 — 미루면 아직 끝나지 않은 상태로 그 문구가 나간다(codex review #637).
    // 실패는 삼키고 링크만 비운다. 성과는 이미 career_profile 에 저장됐고, 여기서 던지면
    // 성공한 회고까지 실패로 보고돼 카드가 소비된 채 사라진다.
    let portfolioUrl: string | null = null;
    try {
      const portfolio = await this.renderPortfolio.execute({
        slackUserId: payload.slackUserId,
      });
      portfolioUrl = portfolio.url;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `EVENING_CAREER_REFLECT 포트폴리오 반영 실패 (성과 저장은 완료): ${message}`,
      );
    }
    // 실패한 묶음은 PR 참조를 그대로 돌려준다. 카드는 한 번 소비되면 다시 누를 수 없어
    // 사람이 손으로 회고를 다시 요청해야 하는데, 저장소 이름만으로는 무엇을 다시 돌릴지
    // 알 수 없다 — 일시적인 GitHub 호출 실패가 성과의 영구 누락이 된다.
    //
    // 줄바꿈은 `\n` 이어야 한다. `\\n` 으로 쓰면 슬랙에 백슬래시와 n 이 글자 그대로 찍혀
    // 안내가 한 줄로 뭉개진다 — 조용한 유실을 막으려고 만든 문구가 읽히지 않게 된다.
    const failedNote =
      failedGroups.length > 0
        ? `\n⚠️ 반영 실패 ${failedGroups.length}묶음 — 아래 PR 로 다시 요청해주세요:\n${failedGroups
            .map((failed) => this.formatFailedGroup(failed))
            .join('\n')}`
        : '';
    // 포트폴리오가 실패한 회차에 "포트폴리오에 반영했습니다" 라고 하지 않는다. 카드는 이미
    // 소비돼 다시 누를 수 없으므로, 안 된 것을 됐다고 말하면 사용자가 확인할 방법이 없다.
    return {
      message: portfolioUrl
        ? `이력서/포트폴리오에 반영했습니다 (${messages.join(', ')})${failedNote} — ${portfolioUrl}`
        : `이력서에 반영했습니다 (${messages.join(', ')})${failedNote}\n⚠️ 포트폴리오 페이지 갱신은 실패했습니다 — 성과는 저장됐으니 다음 회고나 "포트폴리오 정리해줘" 로 반영됩니다.`,
      artifacts: [],
    };
  }

  /**
   * 실패한 묶음을 다시 돌릴 수 있게 PR 참조를 그대로 돌려준다.
   *
   * 적어둔 맥락도 함께 되돌린다. 카드는 한 번 소비되면 다시 누를 수 없고 입력칸도 사라지므로,
   * 여기서 남기지 않으면 사용자가 손으로 적은 문장이 어디에도 남지 않는다 — 코드에 없는 정보를
   * 붙잡으려고 만든 기능인데 정작 그 문장만 유실된다.
   */
  private formatFailedGroup({ refs, impactContext }: FailedGroup): string {
    const line = `• ${refs.join(' ')}`;
    return impactContext ? `${line}\n  적어두신 맥락: ${impactContext}` : line;
  }
}

interface FailedGroup {
  refs: string[];
  impactContext: string | undefined;
}
