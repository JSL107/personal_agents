import { Injectable } from '@nestjs/common';

import {
  DocEdit,
  DocsAuditPort,
  DocsAuditResult,
  DocsRevisionProposal,
} from '../domain/port/docs-audit.port';
import { CodexDocsJudgeAdapter } from '../infrastructure/codex-docs-judge.adapter';
import { DeterministicDocsChecker } from '../infrastructure/deterministic-docs.checker';
import { DocsRevisionApplier } from '../infrastructure/docs-revision.applier';
import { GitChangedFilesProvider } from '../infrastructure/git-changed-files.provider';

const PASS_SCORE = 90;

// 코드/문서 발췌 로더 — 테스트 주입용. 실제 구현은 모듈에서 fs.readFile 래퍼 주입.
export type DocExcerptReader = (filePath: string) => Promise<string>;

// 문서 드리프트를 일으키는 SoT → 대조/수정 대상 문서(hand-curated) 매핑.
// 1차 README.md 단일. 생성 카탈로그(agent-catalog/env-catalog)는 Layer1 담당이라 제외.
export const SOT_TO_DOC: Readonly<Record<string, string>> = {
  'src/agent-registry/agent-registry.ts': 'README.md',
  'src/config/app.config.ts': 'README.md',
  'src/model-router/application/model-router.usecase.ts': 'README.md',
};

interface BestProposal {
  edits: DocEdit[];
  rationale: string;
  score: number;
}

@Injectable()
export class RunDocsAuditUseCase implements DocsAuditPort {
  constructor(
    private readonly checker: DeterministicDocsChecker,
    private readonly gitFiles: GitChangedFilesProvider,
    private readonly judge: CodexDocsJudgeAdapter,
    private readonly readExcerpt: DocExcerptReader,
    private readonly maxFiles: number = 5,
    private readonly maxIterations: number = 3,
    private readonly revisionApplier: DocsRevisionApplier,
  ) {}

  async runAudit(): Promise<DocsAuditResult> {
    const deterministic = await this.checker.check();
    const files = await this.gitFiles.recentlyChangedSotFiles(this.maxFiles);

    const proposals: DocsRevisionProposal[] = [];
    for (const sotFile of files) {
      const proposal = await this.auditOneFile(sotFile);
      if (proposal) {
        proposals.push(proposal);
      }
    }
    const confirmed = proposals.filter((proposal) => proposal.confirmed);
    const revision =
      confirmed.length > 0
        ? await this.revisionApplier.buildRevision(confirmed)
        : null;
    return { deterministic, proposals, revision };
  }

  // 한 파일에 대한 optimizer↔evaluator 자기수정 루프. 종료조건 3종이 한 함수에 다 보인다:
  // - green: evaluator pass && score>=PASS_SCORE → return confirmed:true.
  // - Bounded Execution: for < maxIterations 반복 캡.
  // - Circuit Breaker: score 가 직전 대비 개선 없으면(정체) break → 미확정.
  // 쿼터 예외는 judge.* 가 throw 하면 자연 전파되어 루프가 끊긴다(circuit break).
  private async auditOneFile(
    sotFile: string,
  ): Promise<DocsRevisionProposal | null> {
    const sotContext = await this.readExcerpt(sotFile);
    const targetDoc = SOT_TO_DOC[sotFile];
    if (!targetDoc) {
      return null; // 매핑 없는 SoT 는 skip
    }
    const docExcerpt = await this.readExcerpt(targetDoc);

    let feedback: string | undefined;
    let best: BestProposal | null = null;
    let previousScore = -1;

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      const optimized = await this.judge.optimize({
        filePath: targetDoc,
        codeContext: sotContext,
        docExcerpt,
        evaluatorFeedback: feedback,
      });
      if (!optimized.needsRevision) {
        return null;
      }

      const verdict = await this.judge.evaluate({
        filePath: targetDoc,
        codeContext: sotContext,
        editsSummary: summarizeEdits(optimized.edits),
      });
      best = {
        edits: optimized.edits,
        rationale: optimized.rationale,
        score: verdict.score,
      };

      if (verdict.pass && verdict.score >= PASS_SCORE) {
        return { filePath: targetDoc, ...best, confirmed: true };
      }
      // Circuit Breaker — 개선 없으면(정체) 더 돌려도 무의미.
      if (iteration > 0 && verdict.score <= previousScore) {
        break;
      }
      previousScore = verdict.score;
      feedback = verdict.feedback;
    }

    // 반복캡/정체로 미확정 종료 — best 를 미확정 제안으로.
    return best ? { filePath: targetDoc, ...best, confirmed: false } : null;
  }
}

// edits 를 evaluator 가 읽을 텍스트로 요약.
function summarizeEdits(
  edits: { oldString: string; newString: string }[],
): string {
  return edits
    .map((e, i) => `#${i + 1}\n- old:\n${e.oldString}\n- new:\n${e.newString}`)
    .join('\n\n');
}
