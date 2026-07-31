import { Inject, Injectable, Logger } from '@nestjs/common';

import { CronIdempotencyService } from '../../common/queue/cron-idempotency.service';
import { CRON_SENT_GUARD_TTL_SECONDS } from '../../common/queue/worker-options.constant';
import { getTodayKstDate } from '../../common/util/kst-date.util';
import {
  SLACK_NOTIFIER_PORT,
  SlackNotifierPort,
} from '../../morning-briefing/domain/port/slack-notifier.port';
import { CreatePreviewUsecase } from '../../preview-gate/application/create-preview.usecase';
import {
  PREVIEW_ACTION_REPOSITORY_PORT,
  PreviewActionRepositoryPort,
} from '../../preview-gate/domain/port/preview-action.repository.port';
import {
  AUTOPILOT_TASKS,
  AutopilotPreviewRequest,
  AutopilotTask,
} from '../domain/autopilot-task.port';
import { PlaybookEntry } from '../domain/playbook.type';

// autopilot preview(저녁 회고→블로그/경력 발행 후보 등)는 하루 1회 cron 발화라, 당일 승인을
// 놓쳐도 다음 발화 직전까지 유효하도록 24h. (기존 1h 는 저녁 카드를 자주 EXPIRED 로 흘려보냄)
const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

// 그룹 × 발화일 단위 멱등 키. 진입부의 재진입 확인(isDone)과 발송 직전 선점(acquireOnce)이
// 반드시 같은 키를 봐야 하므로 한 곳에서만 만든다.
const buildGuardKey = (groupKey: string, firedAtKst: string): string =>
  `autopilot:${groupKey}:${firedAtKst}`;

// 플레이북 그룹을 실행 → 비-skip summaryText 를 메인 메시지로 합치고 detailText 는 스레드 댓글로,
// 멱등 1회 후 다중 타깃 fan-out 발송. T1_PREVIEW task 의 preview 는 CreatePreviewUsecase →
// postPreviewMessage 로 승인 버튼 발송(메인 텍스트와 별개).
// 멱등 가드는 "전달 직전"에 둔다 — task 실행이 실패하면 BullMQ 재시도(attempts)가 살아있도록.
@Injectable()
export class AutopilotOrchestrator {
  private readonly logger = new Logger(AutopilotOrchestrator.name);
  private readonly tasks: Map<string, AutopilotTask>;

  constructor(
    @Inject(AUTOPILOT_TASKS) tasks: AutopilotTask[],
    @Inject(SLACK_NOTIFIER_PORT)
    private readonly slackNotifier: SlackNotifierPort,
    private readonly cronIdempotency: CronIdempotencyService,
    private readonly createPreview: CreatePreviewUsecase,
    @Inject(PREVIEW_ACTION_REPOSITORY_PORT)
    private readonly previewRepository: PreviewActionRepositoryPort,
  ) {
    this.tasks = new Map(tasks.map((task) => [task.id, task]));
  }

  async runGroup(
    groupKey: string,
    entries: PlaybookEntry[],
    ownerSlackUserId: string,
    target: string,
  ): Promise<void> {
    const firedAtKst = getTodayKstDate();
    const guardKey = buildGuardKey(groupKey, firedAtKst);

    // 재진입 차단 — 이 슬롯이 이미 완주(발송 성공)했으면 task 를 하나도 실행하지 않고 끝낸다.
    //
    // 배경: 한 실행이 worker lockDuration 을 넘기면 BullMQ 가 stalled 로 보고 같은 job 을
    // 재큐한다(stalled 검사 기본 30s 주기). 아래 "발송 직전" 가드만 있으면 그 재실행이 LLM 을
    // 전부 다시 호출한 뒤에야 "이미 발송됨" 을 알고 발송만 skip 하고, 그 재실행이 또
    // lockDuration 을 넘겨 다시 stalled 가 되는 자기 증폭 루프가 된다.
    // 실측(2026-07-26 morning-briefing): 12회 연쇄 재실행, 각 16~33분, LLM 호출 12회 낭비.
    // → 무거운 작업 앞에서 완주 여부를 먼저 확인해 루프를 끊는다.
    //
    // 읽기 전용(isDone)을 쓰는 이유는 cron-idempotency.service.ts 의 isDone 주석 참조 —
    // 진입 시점에 키를 만들면 실행 중 강제 종료 시 그 슬롯이 TTL 동안 영구 차단된다.
    if (await this.cronIdempotency.isDone(guardKey)) {
      this.logger.warn(
        `Autopilot[${groupKey}] — ${firedAtKst} 이미 완주됨, 재진입 차단 (task 실행 skip)`,
      );
      return;
    }

    const items: { summary: string; detail?: string }[] = [];
    const previews: AutopilotPreviewRequest[] = [];

    for (const entry of entries) {
      const task = this.tasks.get(entry.taskId);
      if (!task) {
        throw new Error(`Autopilot: task 미등록 — taskId=${entry.taskId}`);
      }
      // 한 task 의 런타임 실패(모델 응답 파싱 실패 / LLM hang 등 외부 변동)가 그룹 전체를
      // 죽여 cron job 을 throw 시키지 않도록 격리한다. (이전엔 work-reviewer 의 JSON 파싱
      // 실패가 evening 그룹 전체를 실패시켜 daily-eval 보고까지 누락 + cron 실패 알람 발사.)
      // 설정 오류(미등록)는 위에서 여전히 fail-fast — 운영 변동만 격리한다.
      // T1_PREVIEW entry 는 preview 가 없으면(게이트 OFF) 자연히 텍스트 경로로 폴백한다.
      try {
        const result = await task.run({ ownerSlackUserId, firedAtKst });
        if (result.preview) {
          previews.push(result.preview);
        }
        if (result.previews) {
          previews.push(...result.previews);
        }
        if (!result.skip && result.summaryText) {
          items.push({
            summary: result.summaryText,
            detail: result.detailText,
          });
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Autopilot[${groupKey}] task '${entry.taskId}' 실패 (그룹은 계속): ${message}`,
          error instanceof Error ? error.stack : undefined,
        );
        // 조용한 실패 방지 — owner digest 에 짧게 표기. message 는 길이 cap.
        items.push({
          summary: `_⚠️ ${entry.taskId} 자동 생성 실패 — ${message.slice(0, 200)}. 다음 슬롯에 재시도됩니다._`,
        });
      }
    }

    if (items.length === 0 && previews.length === 0) {
      this.logger.log(`Autopilot[${groupKey}] — 보고 내용 없음, 전달 skip`);
      return;
    }

    const firstRun = await this.cronIdempotency.acquireOnce(
      guardKey,
      CRON_SENT_GUARD_TTL_SECONDS,
    );
    if (!firstRun) {
      this.logger.warn(
        `Autopilot[${groupKey}] — ${firedAtKst} 이미 발송됨, 중복 차단`,
      );
      return;
    }

    const targets = target
      .split(',')
      .map((resolved) => resolved.trim())
      .filter((resolved) => resolved.length > 0);

    // 메인 요약(합침) + 각 항목 detail 을 스레드 댓글로.
    // 메인 요약 발송이 실패하면 위에서 선점한 멱등 가드를 롤백한 뒤 rethrow 한다.
    // 그래야 BullMQ 재시도가 같은 슬롯을 "이미 발송됨" 으로 차단하지 않고 다시 발송한다.
    // (가드를 acquireOnce 단계에서 소비한 채 메인 발송이 실패하면 재시도가 영구 차단돼
    //  저녁 다이제스트가 통째로 미전송되던 버그 — 가드는 "발송 성공 시에만" 소비되어야 한다.)
    // 스레드 상세(detail) 발송 실패는 아래 자체 try/catch 로 swallow 하므로 롤백 대상이 아니다.
    // ⚠️ 가드는 group 단위 단일 키(target 별 아님)다. 다중 target 부분 실패(앞 target 성공 후
    //    뒤 target 실패) 시 release+rethrow → 재시도가 성공한 target 에도 재발송한다 —
    //    "전 target 미전송" 보다 작은 해악으로 수용(단일 target 운영 기준). 완전 제거는 target 별 가드.
    try {
      if (items.length > 0) {
        const mainText = items
          .map((item) => item.summary)
          .join('\n\n────────\n\n');
        for (const resolved of targets) {
          const { ts } = await this.slackNotifier.postMessage({
            target: resolved,
            text: mainText,
          });
          if (ts) {
            for (const item of items) {
              if (item.detail) {
                try {
                  await this.slackNotifier.postMessage({
                    target: resolved,
                    text: item.detail,
                    threadTs: ts,
                  });
                } catch (error: unknown) {
                  const message =
                    error instanceof Error ? error.message : String(error);
                  this.logger.warn(
                    `Autopilot[${groupKey}] 스레드 댓글 발송 실패 (메인 발송 유지): ${message}`,
                  );
                }
              }
            }
          } else {
            // 메인 메시지 ts 미반환(Slack API 이상 등) — 스레드 상세를 붙일 수 없어 skip.
            // 메인 요약은 이미 발송됐고 detail 만 누락되므로 데이터 손실은 아니나, 관측성 위해 경고.
            const skippedDetailCount = items.filter(
              (item) => item.detail,
            ).length;
            if (skippedDetailCount > 0) {
              this.logger.warn(
                `Autopilot[${groupKey}] ${resolved} 메인 메시지 ts 미반환 — 스레드 상세 ${skippedDetailCount}건 skip`,
              );
            }
          }
        }
      }
    } catch (error: unknown) {
      await this.cronIdempotency.release(guardKey);
      throw error;
    }

    // T1_PREVIEW — preview 별로 PENDING 생성 + 버튼 메시지(각 타깃).
    // 각 preview 를 독립 격리한다: 한 카드의 생성/발송 실패가 (1) 뒤 preview 를 죽이지 않고
    // (이전엔 첫 카드 발송 실패가 예외로 루프를 깨 이후 카드까지 통째 유실됐다),
    // (2) group cron job 을 throw 시켜 이미 성공한 메인 다이제스트·앞 카드의 재시도(중복 발송·
    //     중복 승인/이중 발행)를 유발하지 않게 한다.
    // 실패한 카드는 자동 재발송하지 않는 대신(중복 발행 위험 회피) owner 에게 통지해 조용한
    // 유실을 막는다. (완전 자동 복구는 preview 단위 멱등 가드가 필요 — 후속.)
    for (const preview of previews) {
      try {
        const created = await this.createPreview.execute({
          slackUserId: ownerSlackUserId,
          kind: preview.kind,
          payload: preview.payload,
          previewText: preview.previewText,
          responseUrl: null,
          ttlMs: PREVIEW_TTL_MS,
        });
        let coordinateSaved = false;
        for (const resolved of targets) {
          const { channelId, messageTs } =
            await this.slackNotifier.postPreviewMessage({
              target: resolved,
              previewText: preview.previewText,
              previewId: created.id,
            });
          // 첫 타깃 좌표만 저장 — preview 행은 좌표 하나만 가진다(다중 타깃은 알려진 한계).
          if (!coordinateSaved && messageTs) {
            await this.previewRepository.attachSlackMessage({
              id: created.id,
              slackChannelId: channelId,
              slackMessageTs: messageTs,
            });
            coordinateSaved = true;
          }
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Autopilot[${groupKey}] 승인 카드 '${preview.kind}' 생성/발송 실패 (다른 카드는 계속): ${message}`,
          error instanceof Error ? error.stack : undefined,
        );
        await this.notifyPreviewFailure(targets, preview.kind, message);
      }
    }

    this.logger.log(
      `Autopilot[${groupKey}] — 발송 완료 ${targets.length}건 (${entries.length} task, preview ${previews.length})`,
    );
  }

  // 승인 카드 발송 실패를 owner digest 채널에 통지 — 조용한 유실 방지(자동 재발송은 안 함).
  // 통지 자체 실패는 로그만 남긴다(이미 상위에서 error 로그됨) — 재귀적 실패로 번지지 않게.
  private async notifyPreviewFailure(
    targets: string[],
    kind: string,
    message: string,
  ): Promise<void> {
    const text = `_⚠️ 승인 카드 발송 실패 (${kind}) — ${message.slice(0, 200)}. 자동 재발송되지 않으니 필요 시 수동 재실행해주세요._`;
    for (const resolved of targets) {
      try {
        await this.slackNotifier.postMessage({ target: resolved, text });
      } catch (notifyError: unknown) {
        const notifyMessage =
          notifyError instanceof Error
            ? notifyError.message
            : String(notifyError);
        this.logger.warn(
          `Autopilot 승인 카드 실패 통지마저 실패 (${resolved}): ${notifyMessage}`,
        );
      }
    }
  }
}
