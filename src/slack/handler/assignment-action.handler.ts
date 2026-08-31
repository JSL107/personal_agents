import { Injectable, Logger } from '@nestjs/common';
import { App } from '@slack/bolt';

import {
  AssignmentOutput,
  BeAssignmentType,
  CtoBeChainPayload,
} from '../../agent/cto/domain/cto.type';
import { UpdatePreviewPayloadUsecase } from '../../preview-gate/application/update-preview-payload.usecase';
import {
  extractActionBlockId,
  extractActionUserId,
  extractSelectedOptionValue,
} from '../bolt/action-body.parser';
import { SlackHandler } from '../domain/port/slack-handler.port';
import {
  ASSIGNMENT_ACTION_IDS,
  buildAssignmentCardBlocks,
  parseAssignmentBlockId,
  parseSelectedWorker,
} from '../format/assignment-card.builder';
import { toUserFacingErrorMessage } from './slack-handler.helper';

// CTO 분배 카드의 worker 드롭다운 처리.
//
// 실행/취소 버튼은 PreviewGate 공용 action(PREVIEW_ACTION_IDS)이 그대로 받는다. 여기서
// 다루는 건 "승인 전에 승인 대상을 고치는" 조작뿐이라, preview 를 새로 만들지 않고
// 같은 카드의 payload 만 갱신한 뒤 카드를 다시 그린다.
//
// 드롭다운은 LLM 을 태우지 않는다 — 사용자가 고른 값이 곧 결과라 재분류 오차가 없고
// 응답도 즉시다. 문장 재배정 경로(CTO 재실행)는 그대로 살려둔다: 우선순위 조정이나
// 보류로 빼기처럼 드롭다운으로 표현되지 않는 요청이 있기 때문.
@Injectable()
export class AssignmentActionHandler implements SlackHandler {
  private readonly logger = new Logger(AssignmentActionHandler.name);

  constructor(
    private readonly updatePreviewPayload: UpdatePreviewPayloadUsecase,
  ) {}

  register(app: App): void {
    app.action(
      ASSIGNMENT_ACTION_IDS.SET_WORKER,
      async ({ ack, body, respond }) => {
        await ack();
        const target = parseAssignmentBlockId(extractActionBlockId(body));
        const worker = parseSelectedWorker(extractSelectedOptionValue(body));
        const slackUserId = extractActionUserId(body);
        if (!target || !worker || !slackUserId) {
          this.logger.warn(
            '분배 드롭다운 이벤트 해석 실패 — block_id / 선택값 / 사용자 중 누락.',
          );
          return;
        }

        try {
          const updated = await this.updatePreviewPayload.execute({
            previewId: target.previewId,
            slackUserId,
            update: (current) => {
              const payload = parsePayload(current);
              return target.kind === 'PENDING'
                ? promoteUnassigned({
                    payload,
                    index: target.index,
                    worker,
                  })
                : applyWorkerChange({
                    payload,
                    index: target.index,
                    worker,
                  });
            },
          });
          const payload = parsePayload(updated.payload);
          this.logger.log(
            `분배 ${target.kind === 'PENDING' ? '보류 승격' : '배정 변경'} — previewId=${target.previewId} index=${target.index} → ${worker}`,
          );
          await respond({
            replace_original: true,
            text:
              target.kind === 'PENDING'
                ? '📋 CTO 분배 결과 (보류 항목 배정됨)'
                : '📋 CTO 분배 결과 (배정 변경됨)',
            blocks: buildAssignmentCardBlocks({
              output: toDisplayOutput(payload),
              previewId: target.previewId,
            }) as never,
          });
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `분배 카드 갱신 실패 — previewId=${target.previewId} kind=${target.kind}: ${message}`,
          );
          // 카드는 그대로 두고 실패만 알린다 — 여기서 카드를 덮으면 사용자가
          // 직전까지 고쳐둔 배정을 화면에서 잃는다.
          await respond({
            response_type: 'ephemeral',
            replace_original: false,
            text: `배정 변경 실패: ${toUserFacingErrorMessage(error)}`,
          });
        }
      },
    );
  }
}

// 배정 1건을 바꾼 새 payload. 원본을 건드리지 않고 사본을 만든다.
// 사용자가 직접 고른 값이므로 근거는 "사용자 지정", 확신도는 1 로 덮는다 —
// LLM 이 남긴 추론 근거를 그대로 두면 바뀐 배정과 설명이 어긋난다.
export const applyWorkerChange = ({
  payload,
  index,
  worker,
}: {
  payload: CtoBeChainPayload;
  index: number;
  worker: BeAssignmentType;
}): CtoBeChainPayload => {
  if (index >= payload.assignments.length) {
    throw new Error(
      `분배 항목 ${index + 1} 번이 카드에 없습니다 — 카드가 오래됐을 수 있습니다.`,
    );
  }
  return {
    ...payload,
    assignments: payload.assignments.map((assignment, current) =>
      current === index
        ? {
            ...assignment,
            beAssignment: worker,
            reasoning: '사용자 지정',
            confidence: 1,
          }
        : assignment,
    ),
  };
};

// 보류 항목에 담당을 고른 새 payload. 보류 목록에서 빼고 실행 대상(assignments) 끝에 붙인다.
// 예전에는 이 이동이 자연어 재배정(CTO 재실행) 으로만 가능했다 — 사용자가 카드를 떠나
// 문장을 쓰고, LLM 이 어느 항목인지 다시 맞혀야 했다. 드롭다운은 대상도 값도 확정이다.
export const promoteUnassigned = ({
  payload,
  index,
  worker,
}: {
  payload: CtoBeChainPayload;
  index: number;
  worker: BeAssignmentType;
}): CtoBeChainPayload => {
  const pending = payload.unassignedTasks ?? [];
  // ponytail: 대상은 카드가 그려진 시점의 순번으로 찾는다. 승격은 보류 목록을 줄이므로,
  // 카드가 다시 그려지기 전에 같은 카드에서 두 번째 드롭다운을 고르면 뒤 항목이 한 칸씩
  // 당겨져 옆 항목이 배정될 수 있다 (배정 항목 교체에는 없던 위험 — 그쪽은 목록 길이가
  // 그대로다). 조작 즉시 replace_original 로 카드를 다시 그리므로 창이 좁고, 어긋나도
  // 실행 전 카드에 그대로 보인다. 순번 대신 taskId 로 찾으려면 block_id 형식부터
  // 바꿔야 한다 (taskId 에 콜론이 들어가 3-세그먼트 파싱이 깨진다).
  if (index >= pending.length) {
    throw new Error(
      `보류 항목 ${index + 1} 번이 카드에 없습니다 — 카드가 오래됐을 수 있습니다.`,
    );
  }
  const promoted = pending[index];
  return {
    ...payload,
    assignments: [
      ...payload.assignments,
      {
        taskId: promoted.taskId,
        taskTitle: promoted.taskTitle,
        beAssignment: worker,
        // 사용자가 보류에서 직접 꺼낸 항목이므로 오늘 진행(2). 더 급하면 우선순위는
        // 말로 조정한다 — 드롭다운이 표현하지 않는 축이다.
        priority: 2,
        reasoning: '사용자 지정',
        confidence: 1,
      },
    ],
    unassignedTasks: pending.filter((_, current) => current !== index),
  };
};

// 카드 재렌더용 표시 데이터. payload 는 실행에 필요한 assignments 를 중심으로 들고 있고,
// 요약·보류 목록은 표시용 optional 이라 없으면 빈 값으로 채운다.
export const toDisplayOutput = (
  payload: CtoBeChainPayload,
): AssignmentOutput => ({
  assignments: payload.assignments,
  unassignedTasks: payload.unassignedTasks ?? [],
  ctoSummary: payload.ctoSummary ?? '',
});

// Prisma JSON 에서 unknown 으로 들어온 payload 를 좁힌다.
const parsePayload = (payload: unknown): CtoBeChainPayload => {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('분배 카드 payload 가 객체가 아닙니다.');
  }
  const candidate = payload as Record<string, unknown>;
  if (!Array.isArray(candidate.assignments)) {
    throw new Error('분배 카드 payload 에 assignments 가 없습니다.');
  }
  return payload as unknown as CtoBeChainPayload;
};
