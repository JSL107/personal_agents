import { Injectable } from '@nestjs/common';

import {
  precheckEdits,
  REQUIRED_RUBRIC_KEYS,
} from '../domain/docs-audit-rubric';
import { RubricItemKey } from '../domain/docs-audit-rubric.type';
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
  failedRequired: RubricItemKey[];
}

// 한 파일의 판정 재료 — 회차가 바뀌어도 그대로다.
interface AuditContext {
  targetDoc: string;
  sotContext: string;
  docExcerpt: string;
  // 원문 유일성은 발췌(8000자)가 아니라 문서 전체로 본다 — 적용기와 같은 기준.
  fullDoc: string;
}

interface IterationState {
  context: AuditContext;
  remaining: number;
  feedback: string | undefined;
  best: BestProposal | null;
  // 직전 회차에 통과하지 못한 필수 항목 수. 첫 회차는 비교 대상이 없어 무한대.
  previousFailures: number;
}

interface JudgeRoundParams {
  context: AuditContext;
  edits: DocEdit[];
}

interface JudgeRoundResult {
  pass: boolean;
  score: number;
  failedRequired: RubricItemKey[];
  feedback: string;
}

interface ToProposalParams {
  filePath: string;
  best: BestProposal;
  confirmed: boolean;
}

const toProposal = ({
  filePath,
  best,
  confirmed,
}: ToProposalParams): DocsRevisionProposal => ({
  filePath,
  ...best,
  confirmed,
});

// 미확정으로 끝날 때 남길 제안 — 마지막 회차가 아니라 실패 필수 항목이 가장 적었던 회차.
// 같으면 피드백을 더 반영한 뒤 회차를 남긴다.
const pickBetter = ({ best, candidate }: PickBetterParams): BestProposal => {
  if (!best) {
    return candidate;
  }
  const improved =
    candidate.failedRequired.length <= best.failedRequired.length;
  return improved ? candidate : best;
};

interface PickBetterParams {
  best: BestProposal | null;
  candidate: BestProposal;
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
    private readonly readFullDoc: DocExcerptReader,
  ) {}

  async runAudit(): Promise<DocsAuditResult> {
    const deterministic = await this.checker.check();
    const files = await this.gitFiles.recentlyChangedSotFiles(this.maxFiles);
    // 매핑이 없는 SoT 는 판정 루프의 첫 분기에서 빠져 LLM 을 한 번도 부르지 않는다.
    // 후보 수를 이 필터 **전** 값으로 세면 흔적(AutopilotTaskTrace)이 "후보가 있었으니
    // LLM 을 불렀다" 고 잘못 적어, 정작 가리려던 원인("판정 대상이 없었다")을 덮는다.
    const judgeTargets = files.filter(
      (sotFile) => SOT_TO_DOC[sotFile] !== undefined,
    );

    const proposals: DocsRevisionProposal[] = [];
    for (const sotFile of judgeTargets) {
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
    return {
      deterministic,
      proposals,
      revision,
      candidateFileCount: judgeTargets.length,
    };
  }

  // 한 파일에 대한 optimizer↔evaluator 자기수정 루프. 종료 조건은 iterate 한 곳에 다 보인다.
  private async auditOneFile(
    sotFile: string,
  ): Promise<DocsRevisionProposal | null> {
    const sotContext = await this.readExcerpt(sotFile);
    const targetDoc = SOT_TO_DOC[sotFile];
    if (!targetDoc) {
      return null; // 매핑 없는 SoT 는 skip
    }
    const docExcerpt = await this.readExcerpt(targetDoc);
    const fullDoc = await this.readFullDoc(targetDoc);
    return this.iterate({
      context: { targetDoc, sotContext, docExcerpt, fullDoc },
      remaining: this.maxIterations,
      feedback: undefined,
      best: null,
      previousFailures: Number.POSITIVE_INFINITY,
    });
  }

  // 회차 하나를 돌고, 끝나지 않았으면 다음 회차로 넘어간다. 종료 조건:
  // - 고칠 게 없음 → null (제안 없음).
  // - 필수 채점 항목 모두 통과 → 확정.
  // - 실패 필수 항목 수가 직전보다 줄지 않음(정체) 또는 반복 상한 → 가장 나았던 회차를 미확정으로.
  // 쿼터 예외는 judge.* 가 throw 하면 그대로 전파되어 루프가 끊긴다.
  private async iterate({
    context,
    remaining,
    feedback,
    best,
    previousFailures,
  }: IterationState): Promise<DocsRevisionProposal | null> {
    if (remaining === 0) {
      // 반복 상한 — 남은 최선 제안이 있으면 미확정으로, 없으면 null.
      return (
        best &&
        toProposal({ filePath: context.targetDoc, best, confirmed: false })
      );
    }
    const optimized = await this.judge.optimize({
      filePath: context.targetDoc,
      codeContext: context.sotContext,
      docExcerpt: context.docExcerpt,
      evaluatorFeedback: feedback,
    });
    if (!optimized.needsRevision) {
      return null;
    }

    const round = await this.judgeRound({ context, edits: optimized.edits });
    const candidate: BestProposal = {
      edits: optimized.edits,
      rationale: optimized.rationale,
      score: round.score,
      failedRequired: round.failedRequired,
    };
    if (round.pass) {
      return toProposal({
        filePath: context.targetDoc,
        best: candidate,
        confirmed: true,
      });
    }
    const nextBest = pickBetter({ best, candidate });
    const failures = round.failedRequired.length;
    if (failures >= previousFailures) {
      return toProposal({
        filePath: context.targetDoc,
        best: nextBest,
        confirmed: false,
      });
    }
    return this.iterate({
      context,
      remaining: remaining - 1,
      feedback: round.feedback,
      best: nextBest,
      previousFailures: failures,
    });
  }

  // 결정론 사전검사가 먼저다. 걸리면 평가자를 부르지 않고, 필수 항목 전부 실패로 센다.
  private async judgeRound({
    context,
    edits,
  }: JudgeRoundParams): Promise<JudgeRoundResult> {
    const precheckFailures = precheckEdits({ fullDoc: context.fullDoc, edits });
    if (precheckFailures.length > 0) {
      return {
        pass: false,
        score: 0,
        failedRequired: [...REQUIRED_RUBRIC_KEYS],
        feedback: precheckFailures.join('\n'),
      };
    }
    const verdict = await this.judge.evaluate({
      filePath: context.targetDoc,
      codeContext: context.sotContext,
      docExcerpt: context.docExcerpt,
      editsSummary: summarizeEdits(edits),
    });
    return {
      pass: verdict.pass,
      score: verdict.score,
      failedRequired: verdict.failedRequired,
      feedback: verdict.feedback,
    };
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
