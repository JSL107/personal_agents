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

// 그룹 × 발화일 단위 발송 가드 키 — "같은 날 두 번 발송하지 않는다".
const buildGuardKey = (groupKey: string, firedAtKst: string): string =>
  `autopilot:${groupKey}:${firedAtKst}`;

// 그룹 × 스케줄 슬롯 단위 완주 표식 — 재진입 차단 전용. 슬롯 = BullMQ job id 로,
// stalled 로 재큐된 같은 job 만 같은 값을 가진다(다음 스케줄 슬롯은 새 job = 새 키).
//
// 재진입 확인에 위 발송 가드(날짜 키)를 쓰면 안 된다: 하루에 여러 번 도는 그룹
// (preview-sweeper `*/10`, pr-review-sweep `*/3`, run-sweeper 매시간)은 그날 첫 발송으로
// 날짜 키가 생기는 순간 남은 슬롯 전부가 진입에서 끊겨, 알림뿐 아니라 만료 카드 정리·좀비 run
// 정리 같은 실제 작업까지 하루 종일 멈춘다(날짜 키 TTL 25h).
const buildSlotKey = (groupKey: string, slotId: string): string =>
  `autopilot:slot:${groupKey}:${slotId}`;

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
    slotId?: string,
  ): Promise<void> {
    const firedAtKst = getTodayKstDate();
    const guardKey = buildGuardKey(groupKey, firedAtKst);
    const slotKey = slotId ? buildSlotKey(groupKey, slotId) : null;
    const targets = target
      .split(',')
      .map((resolved) => resolved.trim())
      .filter((resolved) => resolved.length > 0);

    // 재진입 차단 — 이 슬롯이 이미 완주했으면 task 를 하나도 실행하지 않고 끝낸다.
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
    //
    // ⚠️ 알려진 한계: 이 확인은 "완주한 슬롯" 만 끊는다. 앞 실행이 아직 task 를 도는 중에
    // 들어온 재큐는 표식이 아직 없어 그대로 통과한다 — lockDuration 초과가 곧 "아직 실행 중"
    // 이므로 원리상 겹칠 수 있다. 실측(2026-07-26)은 앞 실행 종료 30초 뒤 다음이 시작하는
    // 순차 패턴이라 이 확인으로 끊긴다. 겹침까지 막으려면 진입 잠금이 필요한데, 그건 강제
    // 종료 시 슬롯이 TTL 동안 영구 차단되는 문제를 다시 부른다(위 문단) — 의도적 절충이다.
    if (slotKey && (await this.cronIdempotency.isDone(slotKey))) {
      this.logger.warn(
        `Autopilot[${groupKey}] — 슬롯 ${slotId} 이미 완주됨, 재진입 차단 (task 실행 skip)`,
      );
      return;
    }
    if (slotKey === null) {
      // 슬롯 식별자가 없으면 재진입 차단이 통째로 꺼진다. 조용히 꺼지지 않게 남긴다
      // (BullMQ repeatable job 은 항상 id 를 가지므로 정상 경로에서는 나오지 않는다).
      this.logger.debug(
        `Autopilot[${groupKey}] — 슬롯 식별자 없음, 재진입 차단 비활성`,
      );
    }

    const items: {
      summary: string;
      detail?: string;
      onDelivered?: () => Promise<void>;
      unfurlLinks?: boolean;
    }[] = [];
    const previews: AutopilotPreviewRequest[] = [];
    let hasDeliverableSummary = false;
    let failedTaskCount = 0;

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
          hasDeliverableSummary = true;
          items.push({
            summary: result.summaryText,
            detail: result.detailText,
            onDelivered: result.onDelivered,
            unfurlLinks: result.unfurlLinks,
          });
        }
      } catch (error: unknown) {
        failedTaskCount += 1;
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

    // 전달할 summary/preview 산출물이 없고 실패가 하나라도 있는데 실패 안내만 발송하면 cron 이
    // 성공 처리된다. 그러면 발송 가드와 슬롯 완주 표식까지 남아 BullMQ 재시도가 막히고, 실제
    // 보고가 다음 슬롯까지 유실된다. skip 은 정상 종료지만 전달 산출물은 아니며, preview 생성은
    // 전달 산출물이므로 재시도 조건에서 제외한다.
    if (
      failedTaskCount > 0 &&
      !hasDeliverableSummary &&
      previews.length === 0
    ) {
      const failureNotice = items
        .map((item) => item.summary)
        .join('\n\n────────\n\n');
      for (const resolved of targets) {
        try {
          await this.slackNotifier.postMessage({
            target: resolved,
            text: failureNotice,
          });
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Autopilot[${groupKey}] 전멸 실패 안내 발송 실패 (${resolved}): ${message}`,
          );
        }
      }
      // 여기서 가드를 쓰면 BullMQ retry가 이미 전송된 실행으로 오인해 죽는다. 전멸은 저빈도
      // 그룹에서 드물고 재시도마다 안내가 재발송돼도, 조용한 유실보다 확실히 낫다는 tradeoff다.
      throw new Error('Autopilot: 실행한 모든 task 가 실패했습니다.');
    }

    if (items.length === 0 && previews.length === 0) {
      // 보낼 게 없어도 task 는 다 돌았다 = 이 슬롯은 완주. 표식을 남겨야 재큐가 같은 task 를
      // 또 돌리지 않는다(pr-review-sweep 처럼 결과 없이도 LLM 을 태우는 task 가 있다).
      await this.markSlotDone(slotKey);
      this.logger.log(`Autopilot[${groupKey}] — 보고 내용 없음, 전달 skip`);
      return;
    }

    const firstRun = await this.cronIdempotency.acquireOnce(
      guardKey,
      CRON_SENT_GUARD_TTL_SECONDS,
    );
    if (!firstRun) {
      // 발송만 막혔을 뿐 task 는 전부 돌았다 = 이 슬롯은 완주다. 표식을 남기지 않으면
      // 하루에 여러 번 도는 그룹(preview-sweeper `*/10`, pr-review-sweep `*/3`,
      // run-sweeper 매시간)은 그날 첫 발송 이후 모든 슬롯이 이 경로로 끝나면서 표식 없이
      // 종료되고, 그 슬롯이 stalled 로 재큐되면 진입 확인을 통과해 task 를 처음부터 전부
      // 다시 돈다 — 이 가드가 막으려던 자기 증폭 루프가 그대로 남는다.
      //
      // ⚠️ firstRun=false 는 두 가지를 뜻한다: (1) 앞선 실행이 발송을 마쳤다, (2) 다른 실행이
      // 가드를 선점한 채 아직 발송 중이다. (2)에서 이 표식을 남긴 뒤 선점한 쪽의 발송이
      // 실패하면 그쪽은 날짜 가드만 롤백하므로, 표식이 남아 재시도가 진입에서 차단된다.
      // → 발송 실패 롤백에서 슬롯 표식도 함께 해제한다(같은 job = 같은 slotKey 라 도달 가능).
      await this.markSlotDone(slotKey);
      this.logger.warn(
        `Autopilot[${groupKey}] — ${firedAtKst} 이미 발송됨, 중복 차단`,
      );
      return;
    }

    // 메인 요약(합침) + 각 항목 detail 을 스레드 댓글로.
    // 메인 요약 발송이 실패하면 위에서 선점한 멱등 가드를 롤백한 뒤 rethrow 한다.
    // 그래야 BullMQ 재시도가 같은 슬롯을 "이미 발송됨" 으로 차단하지 않고 다시 발송한다.
    // (가드를 acquireOnce 단계에서 소비한 채 메인 발송이 실패하면 재시도가 영구 차단돼
    //  저녁 다이제스트가 통째로 미전송되던 버그 — 가드는 "발송 성공 시에만" 소비되어야 한다.)
    // 스레드 상세(detail) 발송 실패는 아래 자체 try/catch 로 swallow 하므로 롤백 대상이 아니다.
    // ⚠️ 가드는 group 단위 단일 키(target 별 아님)다. 다중 target 부분 실패(앞 target 성공 후
    //    뒤 target 실패) 시 release+rethrow → 재시도가 성공한 target 에도 재발송한다 —
    //    "전 target 미전송" 보다 작은 해악으로 수용(단일 target 운영 기준). 완전 제거는 target 별 가드.
    // 스레드 상세가 유실된 task 를 표시해 둔다. 상세 발송 실패는 아래에서 삼키는데(메인은
    // 이미 나갔으므로), 그 상태로 후처리까지 부르면 "본문을 못 본 채 처리 완료로 확정" 된다 —
    // job-feed 는 후처리가 알림 표식을 찍으므로 그 공고들이 영영 다시 안 뜬다. 상세를 못 보낸
    // task 는 후처리를 건너뛰고 다음 회차에 다시 보낸다(중복 > 유실, onDelivered 계약과 동일).
    const detailUndelivered = new Set<number>();

    try {
      if (items.length > 0) {
        const mainText = items
          .map((item) => item.summary)
          .join('\n\n────────\n\n');
        // 요약이 한 메시지로 합쳐지므로 미리보기 설정도 메시지 단위다. 한 항목이라도
        // 끄기를 요청하면 끈다 — 켜 두면 그 항목의 링크가 미리보기로 펼쳐져, 정작
        // 끄려던 이유(요약이 미리보기에 파묻힘)가 그대로 남는다.
        const unfurlLinks = items.some((item) => item.unfurlLinks === false)
          ? false
          : undefined;
        for (const resolved of targets) {
          const { ts } = await this.slackNotifier.postMessage({
            target: resolved,
            text: mainText,
            ...(unfurlLinks === false ? { unfurlLinks: false } : {}),
          });
          if (ts) {
            for (const [index, item] of items.entries()) {
              if (item.detail) {
                try {
                  await this.slackNotifier.postMessage({
                    target: resolved,
                    text: item.detail,
                    threadTs: ts,
                    // 미리보기 설정은 스레드 댓글에도 걸어야 한다 — 링크를 여럿 싣는
                    // 목록형 카드(job-feed)는 그 링크가 detail 에 있으므로, 메인에만
                    // 걸면 정작 링크가 있는 쪽에서 미리보기가 그대로 펼쳐진다.
                    // 여긴 항목 하나의 본문이라 그 항목의 설정을 그대로 쓴다.
                    ...(item.unfurlLinks === false
                      ? { unfurlLinks: false }
                      : {}),
                  });
                } catch (error: unknown) {
                  detailUndelivered.add(index);
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
            // 메인 요약은 나갔으니 발송 자체는 실패가 아니다. 다만 상세에 실린 내용은 유실되므로
            // (job-feed 는 공고 목록 전체가 상세에 있다) 그 task 의 후처리는 아래에서 건너뛴다.
            for (const [index, item] of items.entries()) {
              if (item.detail) {
                detailUndelivered.add(index);
              }
            }
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

      // 메인 발송이 여기까지 왔다는 것은 모든 target 에 성공적으로 전달됐다는 뜻이다.
      // 이 시점 이후에만 각 task 의 후처리 콜백을 부른다 — 발송 실패 시엔 절대 부르지
      // 않는다(그래야 "발송 실패했는데 상태만 바뀐" job-feed 알림 표식 선점 같은
      // 사고를 막는다). task 별로 격리해서 부른다 — 한 콜백의 실패가 다른 task 의
      // 후처리를 막으면 안 되고, 콜백 실패가 이미 나간 발송을 실패로 되돌리면 안 된다
      // (실패는 로그만 남기고 삼킨다).
      for (const [index, item] of items.entries()) {
        if (!item.onDelivered) {
          continue;
        }
        if (detailUndelivered.has(index)) {
          this.logger.warn(
            `Autopilot[${groupKey}] 스레드 상세를 못 보내 후처리 건너뜀 — 다음 회차에 다시 발송된다`,
          );
          continue;
        }
        try {
          await item.onDelivered();
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Autopilot[${groupKey}] onDelivered 후처리 실패 (발송은 유지): ${message}`,
          );
        }
      }
    } catch (error: unknown) {
      await this.cronIdempotency.release(guardKey);
      // 겹친 재실행(같은 job = 같은 slotKey)이 "이미 발송됨" 으로 판단해 남긴 완주 표식까지
      // 되돌린다. 날짜 가드만 풀면 표식이 남아 재시도가 진입 확인에서 차단되고, 보고가
      // 슬롯 키 TTL(25h) 동안 통째로 누락된다.
      await this.releaseSlot(slotKey);
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

    await this.markSlotDone(slotKey);
    this.logger.log(
      `Autopilot[${groupKey}] — 발송 완료 ${targets.length}건 (${entries.length} task, preview ${previews.length})`,
    );
  }

  // 이 슬롯 완주 표식 — stalled 재큐가 다시 들어와도 진입부에서 끊기게 한다.
  // 완주 시점에만 남긴다: 실행 도중 강제 종료되면 표식이 없어 재시도가 살아있다.
  // TTL 은 발송 가드와 같은 값을 재사용한다 — 슬롯 키는 슬롯마다 고유해 다음 슬롯을 막지 않으므로
  // 길어도 무해하고, 짧게 잡아 재큐 창을 놓치는 편이 더 위험하다.
  private async markSlotDone(slotKey: string | null): Promise<void> {
    if (!slotKey) {
      return;
    }
    await this.cronIdempotency.acquireOnce(
      slotKey,
      CRON_SENT_GUARD_TTL_SECONDS,
    );
  }

  // 완주 표식 롤백 — 발송이 실패했으면 이 슬롯은 완주가 아니다. 겹친 재실행이 남겼을 수도
  // 있는 표식까지 지워 재시도가 진입 확인을 통과하게 한다. 해제 자체의 실패는 로그만 남긴다
  // (이미 상위에서 원래 예외를 던지는 중이라, 여기서 예외를 바꿔치기하면 원인이 가려진다).
  private async releaseSlot(slotKey: string | null): Promise<void> {
    if (!slotKey) {
      return;
    }
    try {
      await this.cronIdempotency.release(slotKey);
    } catch (error: unknown) {
      this.logger.warn(
        `Autopilot — 슬롯 표식 해제 실패 (${slotKey}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
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
