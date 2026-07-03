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
  AUTOPILOT_TASKS,
  AutopilotPreviewRequest,
  AutopilotTask,
} from '../domain/autopilot-task.port';
import { PlaybookEntry } from '../domain/playbook.type';

const PREVIEW_TTL_MS = 60 * 60 * 1000;

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

    const guardKey = `autopilot:${groupKey}:${firedAtKst}`;
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
    for (const preview of previews) {
      const created = await this.createPreview.execute({
        slackUserId: ownerSlackUserId,
        kind: preview.kind,
        payload: preview.payload,
        previewText: preview.previewText,
        responseUrl: null,
        ttlMs: PREVIEW_TTL_MS,
      });
      for (const resolved of targets) {
        await this.slackNotifier.postPreviewMessage({
          target: resolved,
          previewText: preview.previewText,
          previewId: created.id,
        });
      }
    }

    this.logger.log(
      `Autopilot[${groupKey}] — 발송 완료 ${targets.length}건 (${entries.length} task, preview ${previews.length})`,
    );
  }
}
