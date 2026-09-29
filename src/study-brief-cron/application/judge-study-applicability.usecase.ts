import { join } from 'node:path';

import { Inject, Injectable } from '@nestjs/common';

import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { BuildCodeGraphUsecase } from '../../code-graph/application/build-code-graph.usecase';
import { CodeGraphQueryUsecase } from '../../code-graph/application/code-graph-query.usecase';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  JudgeableStudyBrief,
  STUDY_BRIEF_REPOSITORY_PORT,
  StudyBriefRepositoryPort,
} from '../domain/port/study-brief.repository.port';
import { parseApplicabilityOutput } from '../domain/study-applicability.parser';
import {
  buildStudyApplicabilityPrompt,
  STUDY_APPLICABILITY_SYSTEM_PROMPT,
} from '../domain/study-applicability.prompt';
import { STUDY_APPLICABILITY_OUTPUT_SCHEMA } from '../domain/study-applicability.schema';
import { ApplicabilityJudgement } from '../domain/study-applicability.type';
import {
  notApplicableWithoutModel,
  validateApplicability,
} from '../domain/study-applicability.validator';

export const STUDY_APPLICABILITY_LOOKBACK_MS = 48 * 60 * 60 * 1_000;
export const MAX_CANDIDATES = 12;

export type StudyApplicabilityRunResult =
  | { status: 'empty' }
  | {
      status: 'judged';
      briefId: number;
      topic: string;
      notionUrl: string | null;
      judgement: ApplicabilityJudgement;
      saved: boolean;
    };

interface JudgeRunResult {
  judgement: ApplicabilityJudgement;
  saved: boolean;
}

@Injectable()
export class JudgeStudyApplicabilityUsecase {
  constructor(
    @Inject(STUDY_BRIEF_REPOSITORY_PORT)
    private readonly studyBriefRepository: StudyBriefRepositoryPort,
    private readonly buildCodeGraph: BuildCodeGraphUsecase,
    private readonly codeGraphQuery: CodeGraphQueryUsecase,
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
  ) {}

  async execute({
    ownerSlackUserId,
    firedAtKst,
  }: {
    ownerSlackUserId: string;
    firedAtKst: string;
  }): Promise<StudyApplicabilityRunResult> {
    const brief = await this.studyBriefRepository.findOldestUnjudgedSince(
      ownerSlackUserId,
      new Date(Date.now() - STUDY_APPLICABILITY_LOOKBACK_MS),
    );
    if (!brief) {
      return { status: 'empty' };
    }
    const outcome = await this.agentRunService.execute<JudgeRunResult>({
      agentType: AgentType.CTO_STUDY,
      triggerType: TriggerType.AUTOPILOT_STUDY_APPLICABILITY_CRON,
      inputSnapshot: {
        slackUserId: ownerSlackUserId,
        briefId: brief.id,
        firedAtKst,
      },
      run: async () => {
        const { judgement, modelUsed } = await this.judge(brief);
        const saved = await this.studyBriefRepository.saveApplicability(
          brief.id,
          judgement,
        );
        return {
          result: { judgement, saved },
          modelUsed,
          output: {
            applicability: judgement.verdict,
            rawVerdict: judgement.rawVerdict,
            citationCount: judgement.citations.length,
          },
        };
      },
    });

    return {
      status: 'judged',
      briefId: brief.id,
      topic: brief.topic,
      notionUrl: brief.notionUrl,
      judgement: outcome.result.judgement,
      saved: outcome.result.saved,
    };
  }

  async judge(
    brief: JudgeableStudyBrief,
  ): Promise<{ judgement: ApplicabilityJudgement; modelUsed: string }> {
    if (brief.keywords.length === 0) {
      return {
        judgement: notApplicableWithoutModel(
          '키워드 없음 — 이 기능 이전 브리프이거나 조사 출력에 KEYWORDS 가 없었다.',
          0,
        ),
        modelUsed: 'deterministic',
      };
    }
    const snapshot = await this.buildCodeGraph.execute({
      rootDir: join(process.cwd(), 'src'),
    });
    if (snapshot.chunks.length === 0) {
      // 빈 후보로 채점한 "해당 없음" 은 거짓 결과다. 던져서 applicability 를 null 로 남기면 다음 날 다시 잡힌다.
      throw new Error(
        'code-graph 스냅샷이 비어 있어 적용 판정을 할 수 없습니다.',
      );
    }
    const candidates = this.codeGraphQuery.findChunksByKeywords({
      snapshot,
      keywords: brief.keywords,
      limit: MAX_CANDIDATES,
    });
    if (candidates.length === 0) {
      return {
        judgement: notApplicableWithoutModel(
          `키워드(${brief.keywords.join(', ')})와 맞는 코드 조각이 없다(흔한 단어 제외 후).`,
          0,
        ),
        modelUsed: 'deterministic',
      };
    }
    const repositoryRootCandidates = candidates.map((candidate) => ({
      ...candidate,
      filePath: `src/${candidate.filePath.replaceAll('\\', '/')}`,
    }));
    const { prompt, sentCandidates } = buildStudyApplicabilityPrompt({
      topic: brief.topic,
      kind: brief.kind,
      reportMd: brief.reportMd,
      sourceUrls: brief.sourceUrls,
      candidates: repositoryRootCandidates,
    });
    const completion = await this.modelRouter.route({
      agentType: AgentType.CTO_STUDY,
      request: {
        prompt,
        systemPrompt: STUDY_APPLICABILITY_SYSTEM_PROMPT,
        outputSchema: STUDY_APPLICABILITY_OUTPUT_SCHEMA,
      },
    });
    return {
      judgement: validateApplicability(
        parseApplicabilityOutput(completion.text),
        sentCandidates,
      ),
      modelUsed: completion.modelUsed,
    };
  }
}
