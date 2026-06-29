import { Injectable } from '@nestjs/common';

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
@Injectable()
export class CodexDocsJudgeAdapter {
  constructor(private readonly modelRouter: ModelRouterUsecase) {}

  async optimize(input: OptimizeInput): Promise<OptimizerOutput> {
    const completion = await this.modelRouter.route({
      agentType: AgentType.DOCS_AUDIT_OPTIMIZER,
      request: {
        prompt: buildOptimizerPrompt(input),
        systemPrompt: OPTIMIZER_SYSTEM_PROMPT,
      },
    });
    const parsed = this.parseJson(completion.text);
    const edits = this.parseEdits(parsed?.edits);
    return {
      needsRevision: parsed?.needsRevision === true && edits.length > 0,
      filePath: input.filePath,
      edits,
      rationale: typeof parsed?.rationale === 'string' ? parsed.rationale : '',
    };
  }

  async evaluate(input: EvaluateInput): Promise<EvaluatorVerdict> {
    const completion = await this.modelRouter.route({
      agentType: AgentType.DOCS_AUDIT_EVALUATOR,
      request: {
        prompt: buildEvaluatorPrompt(input),
        systemPrompt: EVALUATOR_SYSTEM_PROMPT,
      },
    });
    const parsed = this.parseJson(completion.text);
    const score = typeof parsed?.score === 'number' ? parsed.score : 0;
    return {
      pass: parsed?.pass === true,
      score,
      feedback: typeof parsed?.feedback === 'string' ? parsed.feedback : '',
    };
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
