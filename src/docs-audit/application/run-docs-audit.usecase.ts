import { Injectable } from '@nestjs/common';

import {
  DocsAuditPort,
  DocsAuditResult,
  DocsRevisionProposal,
} from '../domain/port/docs-audit.port';
import { CodexDocsJudgeAdapter } from '../infrastructure/codex-docs-judge.adapter';
import { DeterministicDocsChecker } from '../infrastructure/deterministic-docs.checker';
import { GitChangedFilesProvider } from '../infrastructure/git-changed-files.provider';

const PASS_SCORE = 90;

// 코드/문서 발췌 로더 — 테스트 주입용. 실제 구현은 모듈에서 fs.readFile 래퍼 주입.
export type DocExcerptReader = (filePath: string) => Promise<string>;

interface BestProposal {
  proposedDiff: string;
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
  ) {}

  async runAudit(): Promise<DocsAuditResult> {
    const deterministic = await this.checker.check();
    const files = await this.gitFiles.recentlyChangedSotFiles(this.maxFiles);

    const proposals: DocsRevisionProposal[] = [];
    for (const filePath of files) {
      const proposal = await this.auditOneFile(filePath);
      if (proposal) {
        proposals.push(proposal);
      }
    }
    return { deterministic, proposals };
  }

  // 한 파일에 대한 optimizer↔evaluator 자기수정 루프. 종료조건 3종이 한 함수에 다 보인다:
  // - green: evaluator pass && score>=PASS_SCORE → return confirmed:true.
  // - Bounded Execution: for < maxIterations 반복 캡.
  // - Circuit Breaker: score 가 직전 대비 개선 없으면(정체) break → 미확정.
  // 쿼터 예외는 judge.* 가 throw 하면 자연 전파되어 루프가 끊긴다(circuit break).
  private async auditOneFile(
    filePath: string,
  ): Promise<DocsRevisionProposal | null> {
    const codeContext = await this.readExcerpt(filePath);
    const docExcerpt = await this.readExcerpt(filePath);

    let feedback: string | undefined;
    let best: BestProposal | null = null;
    let previousScore = -1;

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      const optimized = await this.judge.optimize({
        filePath,
        codeContext,
        docExcerpt,
        evaluatorFeedback: feedback,
      });
      if (!optimized.needsRevision) {
        return null;
      }

      const verdict = await this.judge.evaluate({
        filePath,
        codeContext,
        proposedDiff: optimized.proposedDiff,
      });
      best = {
        proposedDiff: optimized.proposedDiff,
        rationale: optimized.rationale,
        score: verdict.score,
      };

      if (verdict.pass && verdict.score >= PASS_SCORE) {
        return { filePath, ...best, confirmed: true };
      }
      // Circuit Breaker — 개선 없으면(정체) 더 돌려도 무의미.
      if (iteration > 0 && verdict.score <= previousScore) {
        break;
      }
      previousScore = verdict.score;
      feedback = verdict.feedback;
    }

    // 반복캡/정체로 미확정 종료 — best 를 미확정 제안으로.
    return best ? { filePath, ...best, confirmed: false } : null;
  }
}
