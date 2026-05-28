import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  NOTION_CLIENT_PORT,
  NotionClientPort,
  NotionPlanBlock,
} from '../../../notion/domain/port/notion-client.port';
import { PreviewApplier } from '../../../preview-gate/domain/port/preview-applier.port';
import {
  PREVIEW_KIND,
  PreviewAction,
} from '../../../preview-gate/domain/preview-action.type';
import { EvaluationOutput } from '../domain/po-eval.type';

// V3 §P4 careerLog PreviewGate applier — PoEval 의 careerLog 를 사용자가 지정한 Notion
// 페이지에 append. 호출자 (예: /po-eval 핸들러 follow-up PR) 가 CreatePreviewUsecase 로
// PreviewAction(kind=PO_EVAL_CAREERLOG, payload=PoEvalCareerlogPayload) 를 만들고, 사용자가
// Slack 에서 ✅ 누르면 본 applier 가 호출된다.
// 멱등성은 PreviewAction status 전이 (PENDING → APPLIED) 가 보장 — 같은 preview 두 번 apply X.
export interface PoEvalCareerlogPayload {
  // 대상 Notion 페이지 id — 호출자가 env (CAREER_LOG_NOTION_PAGE_ID 등) 또는 사용자 지정에서
  // 가져와 채워 넣는다. applier 는 page 의 존재 여부를 미리 확인하지 않음 — Notion API 가
  // 404 던지면 catch 에서 사용자에게 명시 에러 메시지.
  notionPageId: string;
  // 사용자 가시 헤딩에 들어갈 라벨 — 보통 careerLog.period ("2026-05-28" 또는 "2026-W22").
  // 자동 트리거 (Daily Eval) 와 manual (/po-eval) 구분 표기는 호출자가 prefix 로 넣는다.
  period: string;
  // EvaluationOutput.careerLog 를 그대로 직렬화. schemaVersion=1 — 향후 schema 변경 시 본 applier
  // 가 분기 처리.
  careerLog: EvaluationOutput['careerLog'];
}

@Injectable()
export class PoEvalCareerlogApplier implements PreviewApplier {
  readonly kind = PREVIEW_KIND.PO_EVAL_CAREERLOG;

  private readonly logger = new Logger(PoEvalCareerlogApplier.name);

  constructor(
    @Inject(NOTION_CLIENT_PORT)
    private readonly notionClient: NotionClientPort,
  ) {}

  async apply(preview: PreviewAction): Promise<string> {
    const payload = this.parsePayload(preview.payload);
    const blocks = buildCareerlogBlocks(payload);
    await this.notionClient.appendBlocks({
      pageId: payload.notionPageId,
      blocks,
    });
    this.logger.log(
      `PoEval careerLog Notion append — pageId=${payload.notionPageId} period=${payload.period} blocks=${blocks.length}`,
    );
    return `Notion 페이지에 careerLog (${payload.period}) ${blocks.length}블록 적재 완료`;
  }

  // payload narrowing — Prisma JSON 에서 unknown 으로 들어옴.
  private parsePayload(payload: unknown): PoEvalCareerlogPayload {
    if (typeof payload !== 'object' || payload === null) {
      throw new Error('PoEvalCareerlogPayload 가 객체가 아닙니다.');
    }
    const obj = payload as Record<string, unknown>;
    if (typeof obj.notionPageId !== 'string' || obj.notionPageId.length === 0) {
      throw new Error(
        'PoEvalCareerlogPayload.notionPageId 가 string 이 아닙니다.',
      );
    }
    if (typeof obj.period !== 'string' || obj.period.length === 0) {
      throw new Error('PoEvalCareerlogPayload.period 가 string 이 아닙니다.');
    }
    if (typeof obj.careerLog !== 'object' || obj.careerLog === null) {
      throw new Error('PoEvalCareerlogPayload.careerLog 가 객체가 아닙니다.');
    }
    this.assertCareerLogShape(obj.careerLog);
    return obj as unknown as PoEvalCareerlogPayload;
  }

  // EvaluationOutput['careerLog'] 의 내부 필드 (achievements / technologies / impact) 가
  // 정확한 type 인지 검사. LLM 직렬화 결과가 unexpected shape 으로 들어왔을 때
  // buildCareerlogBlocks 의 .length / .trim() 이 던지는 TypeError 보다 명시 도메인 에러가
  // 사용자에게 더 유용 — applier 에 도달 전 차단.
  private assertCareerLogShape(careerLog: unknown): void {
    const cl = careerLog as Record<string, unknown>;
    const achievements = cl.achievements as
      | Record<string, unknown>
      | undefined
      | null;
    if (
      typeof achievements !== 'object' ||
      achievements === null ||
      !Array.isArray(achievements.quantitative) ||
      !Array.isArray(achievements.qualitative)
    ) {
      throw new Error(
        'PoEvalCareerlogPayload.careerLog.achievements 가 { quantitative: [], qualitative: [] } 형태가 아닙니다.',
      );
    }
    if (!Array.isArray(cl.technologies)) {
      throw new Error(
        'PoEvalCareerlogPayload.careerLog.technologies 가 array 가 아닙니다.',
      );
    }
    if (typeof cl.impact !== 'string') {
      throw new Error(
        'PoEvalCareerlogPayload.careerLog.impact 가 string 이 아닙니다.',
      );
    }
  }
}

// careerLog → Notion block 변환. 빈 섹션은 skip (Notion 빈 bullet 회피).
// 출력 순서: heading (period) → 정량 성과 (bullets) → 정성 성과 (bullets) → 기술 스택
// (paragraph) → impact (paragraph) → divider.
const buildCareerlogBlocks = (
  payload: PoEvalCareerlogPayload,
): NotionPlanBlock[] => {
  const cl = payload.careerLog;
  const blocks: NotionPlanBlock[] = [
    {
      type: 'heading',
      text: `💼 careerLog — ${payload.period} (schemaVersion=${cl.schemaVersion})`,
    },
  ];
  if (cl.achievements.quantitative.length > 0) {
    blocks.push({ type: 'subheading', text: '정량 성과' });
    for (const item of cl.achievements.quantitative) {
      blocks.push({ type: 'bullet', text: item });
    }
  }
  if (cl.achievements.qualitative.length > 0) {
    blocks.push({ type: 'subheading', text: '정성 성과' });
    for (const item of cl.achievements.qualitative) {
      blocks.push({ type: 'bullet', text: item });
    }
  }
  if (cl.technologies.length > 0) {
    blocks.push({
      type: 'paragraph',
      text: `기술 스택: ${cl.technologies.join(', ')}`,
    });
  }
  if (cl.impact.trim().length > 0) {
    blocks.push({ type: 'paragraph', text: `Impact: ${cl.impact}` });
  }
  blocks.push({ type: 'divider' });
  return blocks;
};
