import { Injectable } from '@nestjs/common';

import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  DocEdit,
  EvaluatorVerdict,
  OptimizerOutput,
} from '../domain/port/docs-audit.port';
import {
  buildEvaluatorPrompt,
  buildOptimizerPrompt,
  EVALUATOR_SYSTEM_PROMPT,
  OPTIMIZER_SYSTEM_PROMPT,
} from '../domain/prompt/docs-audit.prompt';

interface OptimizeInput {
  filePath: string;
  codeContext: string;
  docExcerpt: string;
  evaluatorFeedback?: string;
}

interface EvaluateInput {
  filePath: string;
  codeContext: string;
  editsSummary: string;
}

// Layer 2 LLM — codex(ChatGPT) optimizer/evaluator. model-router 경유(쿼터 소진은 route 가
// ModelRouterException 으로 감싸 전파 → usecase 에서 circuit break). JudgeContradictionUsecase 미러.
// 호출마다 AgentRun 을 남긴다 — 없으면 매주 돌아도 원장이 두 워커를 NEVER_RUN 으로 본다.
// execute 는 실패를 FAILED 로 마감한 뒤 같은 에러를 다시 던지므로 circuit break 는 그대로다.
@Injectable()
export class CodexDocsJudgeAdapter {
  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
  ) {}

  async optimize(input: OptimizeInput): Promise<OptimizerOutput> {
    const outcome = await this.agentRunService.execute<OptimizerOutput>({
      agentType: AgentType.DOCS_AUDIT_OPTIMIZER,
      triggerType: TriggerType.DOCS_AUDIT_LAYER2,
      inputSnapshot: {
        filePath: input.filePath,
        retried: input.evaluatorFeedback !== undefined,
      },
      run: async () => {
        const completion = await this.modelRouter.route({
          agentType: AgentType.DOCS_AUDIT_OPTIMIZER,
          request: {
            prompt: buildOptimizerPrompt(input),
            systemPrompt: OPTIMIZER_SYSTEM_PROMPT,
          },
        });
        const parsed = this.parseJson(completion.text);
        const edits = this.parseEdits(parsed?.edits);
        const result: OptimizerOutput = {
          needsRevision: parsed?.needsRevision === true && edits.length > 0,
          filePath: input.filePath,
          edits,
          rationale:
            typeof parsed?.rationale === 'string' ? parsed.rationale : '',
        };
        return { result, modelUsed: completion.modelUsed, output: result };
      },
    });
    return outcome.result;
  }

  async evaluate(input: EvaluateInput): Promise<EvaluatorVerdict> {
    const outcome = await this.agentRunService.execute<EvaluatorVerdict>({
      agentType: AgentType.DOCS_AUDIT_EVALUATOR,
      triggerType: TriggerType.DOCS_AUDIT_LAYER2,
      inputSnapshot: { filePath: input.filePath },
      run: async () => {
        const completion = await this.modelRouter.route({
          agentType: AgentType.DOCS_AUDIT_EVALUATOR,
          request: {
            prompt: buildEvaluatorPrompt(input),
            systemPrompt: EVALUATOR_SYSTEM_PROMPT,
          },
        });
        const parsed = this.parseJson(completion.text);
        const result: EvaluatorVerdict = {
          pass: parsed?.pass === true,
          score: typeof parsed?.score === 'number' ? parsed.score : 0,
          feedback: typeof parsed?.feedback === 'string' ? parsed.feedback : '',
        };
        return { result, modelUsed: completion.modelUsed, output: result };
      },
    });
    return outcome.result;
  }

  private parseJson(text: string): Record<string, unknown> | null {
    const match = text.match(/\{[\s\S]*\}/u);
    if (!match) {
      return null;
    }
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  // edits 배열을 안전 파싱 — 각 항목이 string oldString/newString 일 때만 채택.
  private parseEdits(raw: unknown): DocEdit[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    const edits: DocEdit[] = [];
    for (const item of raw) {
      if (
        item !== null &&
        typeof item === 'object' &&
        typeof (item as Record<string, unknown>).oldString === 'string' &&
        typeof (item as Record<string, unknown>).newString === 'string' &&
        ((item as Record<string, unknown>).oldString as string).length > 0
      ) {
        const record = item as Record<string, unknown>;
        edits.push({
          oldString: record.oldString as string,
          newString: record.newString as string,
        });
      }
    }
    return edits;
  }
}
