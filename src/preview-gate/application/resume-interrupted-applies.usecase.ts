import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Optional,
} from '@nestjs/common';

import { ConsoleEventBus } from '../../console/application/console-event-bus.service';
import { toConsoleApproval } from '../../console/application/console-mappers';
import {
  PREVIEW_ACTION_REPOSITORY_PORT,
  PreviewActionRepositoryPort,
} from '../domain/port/preview-action.repository.port';
import {
  PREVIEW_APPLIERS,
  PreviewApplier,
} from '../domain/port/preview-applier.port';
import {
  PREVIEW_CARD_PORT,
  PreviewCardPort,
} from '../domain/port/preview-card.port';
import { PreviewAction } from '../domain/preview-action.type';
import { ApplyPreviewUsecase } from './apply-preview.usecase';

// 한 카드가 재개를 포함해 시도할 수 있는 최대 횟수.
//
// 상한이 없으면 **반영 자체가 프로세스를 죽이는 경우 부팅마다 되살아나 무한 루프**가 된다.
// 죽는 이유가 그 작업이라면 두 번째에도 같은 결말이므로, 그때는 사람에게 넘긴다.
const MAX_APPLY_ATTEMPTS = 2;

// pid 가 아직 살아 있는가. 죽은 프로세스의 흔적만 중단으로 판정하기 위한 것이다.
//
// 로컬 DB 는 worktree 백엔드와 공유되므로 "흔적이 남아 있다" 만으로는 중단을 단정할 수 없다 —
// 남이 지금 돌리고 있는 중일 수 있고, 그것을 중단으로 오인해 재개하면 같은 반영이 둘이 된다.
//
// 신호 0 은 프로세스를 건드리지 않고 존재만 확인한다. EPERM 은 "있는데 내 권한 밖" 이므로
// 살아 있는 것이다 — 이것을 죽음으로 읽으면 남의 반영을 가로채 재개한다.
const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

// 마감 안내에서 "무엇이 이미 반영됐는가" 를 말하는 부분.
//
// **어느 경우에도 "반영된 것이 없다" 고 단정하지 않는다.** 원장이 증명하는 것은 "이 단계는
// 끝났다" 뿐이고, 그 반대(= 기록이 없으니 반영도 없었다)는 증명되지 않는다. 단계가 끝난 직후
// 기록이 커밋되기 전에 죽었을 수 있고, 단계 기록을 아예 남기지 않는 applier 는 외부 호출이
// 상대에게 닿았는지조차 알 수 없다. 단정했다가 그 말을 믿고 다시 누르면 중복 반영이다.
const buildPartialNotice = ({
  done,
  sideEffectUncertain,
}: {
  done: readonly string[];
  sideEffectUncertain: boolean;
}): string => {
  if (sideEffectUncertain) {
    return ' 이 작업은 단계별 기록을 남기지 않아 어디까지 반영됐는지 원장으로는 알 수 없습니다. 결과를 먼저 확인한 뒤 다시 누를지 판단해주세요.';
  }
  if (done.length > 0) {
    return ` ${done.length}단계까지 반영된 것이 확인됩니다(${done.join(', ')}). 다시 누르면 그 단계는 건너뛰고 나머지만 이어서 반영합니다.`;
  }
  return ' 반영이 확인된 단계는 없습니다. 다만 마지막 작업이 반영된 직후 기록 전에 끊겼을 수 있으니 결과를 먼저 확인해주세요.';
};

/**
 * 재시작으로 중단된 반영을 부팅 때 이어서 돌리거나, 돌릴 수 없으면 실패로 마감하고 알린다.
 *
 * **왜 필요한가.** 중복 클릭 락(`ApplyPreviewUsecase.applying`)은 프로세스 메모리에 있어
 * 재시작을 넘지 못한다. 그래서 반영 도중 백엔드가 죽으면 "진행 중이었다" 는 사실이 통째로
 * 사라지고, `preview_action.status` 는 PENDING 그대로라 카드가 되살아난다. 사용자에게는 그것이
 * 실패가 아니라 **안 눌린 것**으로 보이므로 다시 누르고, 그때 이미 반영된 단계가 한 번 더
 * 실행된다. 2026-09-23 실측: `EVENING_CAREER_REFLECT` 카드 하나가 09:02~09:22 와 09:59~10:26
 * 두 번 통째로 돌았고(`agent_run` CAREER_MATE 체인), 앞 회차에서 성공한 묶음 2개가 뒤 회차에
 * 다시 반영됐다. `ReflectPrUsecase` 는 "조회 → 병합 → 저장" 이라 멱등이 아니다.
 *
 * **왜 부팅 훅인가.** 흔적이 남았다는 사실은 그것을 쥔 프로세스가 죽어야만 성립한다. 살아 있는
 * 동안은 스스로 지우기 때문이다. 부팅은 그 판정이 가장 확실한 자리다.
 *
 * **왜 전부 재개하지는 않는가.** 단계별 기록을 남기지 않는 applier 는 죽은 시점에 외부 호출이
 * 상대에게 닿았는지를 알 수 없다. 모르는 채 다시 부르면 중복 발행이므로, 그런 카드는 마감하고
 * 사람에게 넘긴다(`PreviewApplier.resumable`).
 *
 * 형제와의 경계: 원장의 `IN_PROGRESS` 회차를 닫는 것은 `AgentRunService` 의 부팅 스윕과
 * `interruptRunsOnSignal` 의 몫이다. 여기는 **승인 카드** 쪽만 본다.
 */
@Injectable()
export class ResumeInterruptedAppliesUsecase implements OnApplicationBootstrap {
  private readonly logger = new Logger(ResumeInterruptedAppliesUsecase.name);

  constructor(
    @Inject(PREVIEW_ACTION_REPOSITORY_PORT)
    private readonly repository: PreviewActionRepositoryPort,
    @Inject(PREVIEW_APPLIERS)
    private readonly appliers: PreviewApplier[],
    @Inject(PREVIEW_CARD_PORT)
    private readonly card: PreviewCardPort,
    private readonly applyPreview: ApplyPreviewUsecase,
    // 콘솔 관제 — ConsoleEventBusModule(@Global) 이 production 에 항상 주입. 미주입 시 emit no-op.
    @Optional()
    private readonly consoleEvents?: ConsoleEventBus,
  ) {}

  // 실패해도 부팅을 막지 않는다. 여기서 못 치운 흔적은 다음 부팅이 다시 본다 —
  // 정리를 못 한 것이 앱이 안 뜨는 것보다 낫다.
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.sweep();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `중단된 반영 정리 실패 — 다음 부팅에 맡긴다: ${message}`,
      );
    }
  }

  // 흔적이 남은 카드를 훑어 재개할 것과 마감할 것으로 가른다.
  // 테스트가 부팅 훅을 거치지 않고 직접 부를 수 있도록 `now` 를 받는다.
  async sweep(now: Date = new Date()): Promise<void> {
    const interrupted = await this.repository.findApplyInterrupted();
    if (interrupted.length === 0) {
      return;
    }

    const resumable: PreviewAction[] = [];
    for (const preview of interrupted) {
      const decision = this.decide(preview, now);
      if (decision.kind === 'SKIP') {
        this.logger.log(
          `반영 흔적 건너뜀 preview=${preview.id} — ${decision.why}`,
        );
        continue;
      }
      if (decision.kind === 'ABANDON') {
        await this.abandon({
          preview,
          reason: decision.why,
          sideEffectUncertain: decision.sideEffectUncertain === true,
          at: now,
        });
        continue;
      }
      resumable.push(preview);
    }

    if (resumable.length === 0) {
      return;
    }
    this.logger.log(
      `중단된 반영 ${resumable.length}건을 이어서 실행 (${resumable
        .map((preview) => preview.id)
        .join(', ')})`,
    );
    // **부팅을 막지 않는다.** 반영 하나가 10분 넘게 걸리므로(실측 7~14분) await 하면 그 동안
    // 앱이 뜨지 않고, 포트를 기준으로 기동을 판정하는 `console-dev.sh` 가 죽은 것으로 본다.
    //
    // 그 대가로 재개가 락(`ApplyPreviewUsecase.applying`)을 잡기 전까지 밀리초 단위의 창이 열린다.
    // 그 사이 콘솔이 스냅샷을 받으면 카드가 잠깐 보이고, 사용자가 누르면 재개와 겹칠 수 있다.
    // 겹쳐도 중복 반영은 되지 않는다 — 두 번째가 물려받는 `done` 에 첫 번째가 끝낸 단계가
    // 들어 있어 applier 가 건너뛴다. 락이 아니라 그 기록이 실제 방어선이다.
    void this.resumeSequentially(resumable);
  }

  // 재개할지 마감할지 건너뛸지. 판정 근거를 문장으로 함께 돌려 로그·사용자 안내에 그대로 쓴다.
  //
  // `sideEffectUncertain` 은 "어디까지 반영됐는지 원장으로 알 수 없다" 는 뜻이다. 단계 기록을
  // 남기지 않는 applier 가 그렇다 — 그 경우 빈 `done` 은 **반영이 없었다는 증거가 아니다.**
  // 이것을 구분하지 않으면 안내가 "반영된 것은 없다" 고 단정해 재시도를 권하고, 그 재시도가
  // 중복 발행이 된다.
  private decide(
    preview: PreviewAction,
    now: Date,
  ): {
    kind: 'SKIP' | 'ABANDON' | 'RESUME';
    why: string;
    sideEffectUncertain?: boolean;
  } {
    const progress = preview.applyProgress;
    // 흔적을 읽지 못한 행(형태 파손)은 중단인지 알 수 없다. 건드리지 않는다.
    if (progress === null) {
      return { kind: 'SKIP', why: '진행 흔적을 읽을 수 없음' };
    }
    // 끝났다고 표시된 시도는 중단이 아니다 — 실패로 닫혔거나 이미 마감된 것이고, `done` 을
    // 남겨 두기 위해 흔적만 보존한 상태다. 이것을 집으면 사용자가 포기한 반영이 부팅마다
    // 되살아나고 같은 안내가 반복된다.
    if (progress.endedAt !== undefined) {
      return { kind: 'SKIP', why: '이미 끝난 시도' };
    }
    if (isProcessAlive(progress.pid)) {
      return {
        kind: 'SKIP',
        why: `pid ${progress.pid} 가 살아 있음 — 다른 백엔드가 반영 중`,
      };
    }
    const applier = this.appliers.find(
      (candidate) => candidate.kind === preview.kind,
    );
    // 단계 기록이 없는 경로는 무엇이 반영됐는지 원장이 말해 주지 못한다. 마감 사유가
    // 무엇이든 이 사실은 안내에 함께 실려야 한다.
    const sideEffectUncertain = applier?.resumable !== true;
    if (preview.expiresAt.getTime() <= now.getTime()) {
      return {
        kind: 'ABANDON',
        why: '승인 유효기간(TTL)이 지났습니다',
        sideEffectUncertain,
      };
    }
    if (progress.attempts >= MAX_APPLY_ATTEMPTS) {
      return {
        kind: 'ABANDON',
        why: `${progress.attempts}번 시도했으나 모두 중단됐습니다`,
        sideEffectUncertain,
      };
    }
    if (!applier) {
      return {
        kind: 'ABANDON',
        why: '이 카드를 반영할 수단이 없습니다',
        sideEffectUncertain: true,
      };
    }
    if (applier.resumable !== true) {
      return {
        kind: 'ABANDON',
        why: '중단 지점을 알 수 없어 이어서 실행할 수 없습니다',
        sideEffectUncertain: true,
      };
    }
    return { kind: 'RESUME', why: '' };
  }

  // 순차로 돌린다. 재개 대상이 여럿이면 대개 같은 저장소·같은 프로필을 건드리는 카드들이라
  // 병렬로 돌리면 뒤엣것이 앞엣것의 결과를 덮어쓴다(applier 들이 순차를 전제한다).
  private async resumeSequentially(previews: PreviewAction[]): Promise<void> {
    for (const preview of previews) {
      try {
        await this.applyPreview.execute({
          previewId: preview.id,
          slackUserId: preview.slackUserId,
        });
        this.logger.log(`중단된 반영 재개 성공 preview=${preview.id}`);
      } catch (error: unknown) {
        // `execute` 가 실패 기록·카드 갱신·실패 통지를 이미 했다. 여기서는 어느 카드였는지만 잇는다.
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `중단된 반영 재개 실패 preview=${preview.id}: ${message}`,
        );
      }
    }
  }

  /**
   * 재개하지 않기로 한 카드를 실패로 마감하고 알린다.
   *
   * status 는 PENDING 그대로 둔다 — 사용자가 거부한 것이 아니므로 그렇게 기록하면
   * `preview-canceller.port.ts` 가 경고한 학습 오염이 된다. 카드는 다시 누를 수 있고,
   * 안내가 그 판단에 필요한 것(일부는 이미 반영됐을 수 있다)을 말해 준다.
   */
  private async abandon({
    preview,
    reason,
    sideEffectUncertain,
    at,
  }: {
    preview: PreviewAction;
    reason: string;
    // 원장이 "어디까지 반영됐는지" 를 말해 주지 못하는 경로인가(단계 기록 없는 applier).
    sideEffectUncertain: boolean;
    at: Date;
  }): Promise<void> {
    const done = preview.applyProgress?.done ?? [];
    const message = `서버 재시작으로 반영이 중단됐습니다. ${reason}.${buildPartialNotice(
      {
        done,
        sideEffectUncertain,
      },
    )}`;

    try {
      await this.repository.recordApplyFailure({
        id: preview.id,
        reason: `[interrupted] ${message}`,
        at,
      });
      // **흔적을 지우지 않고 "끝났다" 표시만 남긴다.** 지우면 `done` 이 함께 사라지는데, 카드는
      // PENDING 이라 다시 눌릴 수 있으므로 다음 승인이 이미 반영된 단계를 처음부터 다시 실행한다.
      // 표시만 남기면 `done` 은 살아 있고 다음 부팅도 이 카드를 다시 집지 않는다.
      await this.repository.endApply({
        id: preview.id,
        pid: preview.applyProgress?.pid ?? process.pid,
        at,
      });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`중단 마감 기록 실패 preview=${preview.id}: ${detail}`);
    }

    // 카드 갱신·통지는 best-effort — 실패해도 마감 자체는 원장에 남았다.
    //
    // **사유를 카드 본문에 실어 보내는 것이 여기서는 필수다.** 이 훅은 `app.listen()` 보다 먼저
    // 돌아 SSE 구독자가 아직 없고, `ConsoleEventBus` 는 구독 이전 이벤트를 재전달하지 않는다.
    // 아래 `approval.failed` 는 부팅 시점에는 사실상 허공으로 나간다 — 슬랙 카드가 이 안내가
    // 사용자에게 닿는 유일한 즉시 경로다(콘솔은 스냅샷의 `failureReason` 으로 뒤따라 받는다).
    try {
      await this.card.update({
        preview,
        state: 'APPLY_FAILED',
        resultText: message,
      });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `중단 마감 카드 갱신 실패 preview=${preview.id}: ${detail}`,
      );
    }
    this.consoleEvents?.publish({
      type: 'approval.failed',
      approval: toConsoleApproval(preview),
      reason: message,
    });
    this.logger.warn(`중단된 반영 마감 preview=${preview.id} — ${message}`);
  }
}
