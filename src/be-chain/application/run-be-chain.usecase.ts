import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { Injectable, Logger } from '@nestjs/common';

import { GenerateBackendPlanUsecase } from '../../agent/be/application/generate-backend-plan.usecase';
import { GenerateSchemaProposalUsecase } from '../../agent/be-schema/application/generate-schema-proposal.usecase';
import { GenerateTestUsecase } from '../../agent/be-test/application/generate-test.usecase';
import {
  Assignment,
  BeAssignmentType,
  BeChainOutcome,
} from '../../agent/cto/domain/cto.type';
import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { AgentType } from '../../model-router/domain/model-router.type';

// CTO 가 분배한 assignment 들을 실제 BE worker 실행으로 옮기는 단계.
//
// 원래 이 로직은 /auto-flow 핸들러 안에만 있어서, 버튼 3단(PM → CTO → BE)을 타지 않으면
// 사용자가 `/be plan ...` 을 손으로 쳐야 했다. 자연어 승인(PreviewGate 의 CTO_BE_CHAIN)
// 경로가 같은 실행을 필요로 하므로 usecase 로 끌어올려 두 진입점이 공유한다.
//
// 실패해도 chain 을 멈추지 않는다 — assignment 5건 중 2번째가 죽었다고 나머지 3건을
// 버리면 사용자는 무엇이 됐고 무엇이 안 됐는지 알 수 없다. 건별 status 로 보고한다.
export interface RunBeChainInput {
  assignments: Assignment[];
  slackUserId: string;
  // 실행된 worker run 들의 AgentRun.parentId 로 기록될 CTO run id — chain audit trail.
  parentRunId: number;
  // BE_SCHEMA worker 에 전달할 트리거 출처. 미지정 시 usecase 기본값 (/auto-flow 는 명시).
  triggerType?: TriggerType;
}

@Injectable()
export class RunBeChainUsecase {
  private readonly logger = new Logger(RunBeChainUsecase.name);

  constructor(
    private readonly generateBackendPlanUsecase: GenerateBackendPlanUsecase,
    private readonly generateSchemaProposalUsecase: GenerateSchemaProposalUsecase,
    private readonly generateTestUsecase: GenerateTestUsecase,
    private readonly agentRunService: AgentRunService,
  ) {}

  async execute({
    assignments,
    slackUserId,
    parentRunId,
    triggerType,
  }: RunBeChainInput): Promise<BeChainOutcome[]> {
    const outcomes: BeChainOutcome[] = [];
    for (const assignment of assignments) {
      const outcome = await this.runOne({
        assignment,
        slackUserId,
        parentRunId,
        triggerType,
      });
      outcomes.push(outcome);
    }
    return outcomes;
  }

  private async runOne({
    assignment,
    slackUserId,
    parentRunId,
    triggerType,
  }: {
    assignment: Assignment;
    slackUserId: string;
    parentRunId: number;
    triggerType?: TriggerType;
  }): Promise<BeChainOutcome> {
    if (assignment.beAssignment === AgentType.BE_TEST) {
      return await this.runBeTest({ assignment, slackUserId, parentRunId });
    }
    try {
      if (assignment.beAssignment === AgentType.BE) {
        const outcome = await this.generateBackendPlanUsecase.execute({
          subject: assignment.taskTitle,
          slackUserId,
        });
        await this.recordParent({ id: outcome.agentRunId, parentRunId });
        return {
          assignment,
          status: 'OK',
          agentRunId: outcome.agentRunId,
          message: `BE plan #${outcome.agentRunId} 생성 완료.`,
        };
      }
      if (assignment.beAssignment === AgentType.BE_SCHEMA) {
        const outcome = await this.generateSchemaProposalUsecase.execute({
          request: assignment.taskTitle,
          slackUserId,
          ...(triggerType !== undefined ? { triggerType } : {}),
        });
        await this.recordParent({ id: outcome.agentRunId, parentRunId });
        return {
          assignment,
          status: 'OK',
          agentRunId: outcome.agentRunId,
          message: `BE_SCHEMA proposal #${outcome.agentRunId} 생성 완료.`,
        };
      }
      const exhaustive: never =
        assignment.beAssignment satisfies BeAssignmentType;
      return {
        assignment,
        status: 'SKIPPED',
        message: `미지원 worker: ${String(exhaustive)}`,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `BE chain worker (${assignment.beAssignment}, ${assignment.taskId}) 실패: ${message}`,
      );
      return {
        assignment,
        status: 'FAILED',
        message: `${assignment.beAssignment} 실패: ${message}`,
      };
    }
  }

  // BE_TEST 만 별도 — 대상 파일 경로가 필요하고, 그 경로가 LLM 추론이라 실행 전 검증이 붙는다.
  private async runBeTest({
    assignment,
    slackUserId,
    parentRunId,
  }: {
    assignment: Assignment;
    slackUserId: string;
    parentRunId: number;
  }): Promise<BeChainOutcome> {
    const filePath = assignment.targetFilePath;
    if (filePath === undefined) {
      return {
        assignment,
        status: 'SKIPPED',
        message:
          'BE_TEST — CTO 가 task 설명에서 file path 를 식별하지 못함. 대상 파일 경로를 알려주시면 이어서 생성합니다.',
      };
    }
    // CTO 가 적은 path 가 실제 repo 에 있는지 검증 — hallucination fast-fail.
    const exists = await fileExistsRelativeToCwd(filePath);
    if (!exists) {
      this.logger.warn(
        `BE chain — BE_TEST targetFilePath '${filePath}' 가 repo 에 없음 (taskId=${assignment.taskId}).`,
      );
      return {
        assignment,
        status: 'SKIPPED',
        message: `BE_TEST — CTO 가 추론한 path \`${filePath}\` 가 실제 repo 에 없습니다 (LLM 추측 가능). 정확한 경로를 알려주시면 이어서 생성합니다.`,
      };
    }
    try {
      const outcome = await this.generateTestUsecase.execute({
        filePath,
        slackUserId,
      });
      await this.recordParent({ id: outcome.agentRunId, parentRunId });
      return {
        assignment,
        status: 'OK',
        agentRunId: outcome.agentRunId,
        message: `BE_TEST spec #${outcome.agentRunId} 생성 완료 — ${filePath}.`,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `BE chain — BE_TEST dispatch 실패 taskId=${assignment.taskId} filePath=${filePath}: ${message}`,
      );
      return {
        assignment,
        status: 'FAILED',
        message: `BE_TEST 실패 — ${message}`,
      };
    }
  }

  // chain audit — parentId 기록 실패는 audit 누락에 그치므로 chain 진행을 멈추지 않는다.
  private async recordParent({
    id,
    parentRunId,
  }: {
    id: number;
    parentRunId: number;
  }): Promise<void> {
    try {
      await this.agentRunService.setParentId({ id, parentId: parentRunId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `BE chain parentId 기록 실패 — childRunId=${id} parentRunId=${parentRunId}: ${message}`,
      );
    }
  }
}

// BE_TEST 분배 시 CTO 가 추론한 targetFilePath 가 실제 repo 에 존재하는지 검증.
// LLM hallucination 으로 가짜 경로 ("src/example.service.ts" 같은) 가 들어오면 fast-fail.
// 보안: absolute path 는 무조건 false — process.cwd() 밖 (e.g. /etc/passwd) 접근 차단.
// path traversal (../) 은 path.resolve 가 normalize 후 cwd prefix 검사로 추가 차단.
export const fileExistsRelativeToCwd = async (
  relativePath: string,
): Promise<boolean> => {
  if (relativePath.length === 0) {
    return false;
  }
  if (path.isAbsolute(relativePath)) {
    return false;
  }
  const cwd = process.cwd();
  const resolved = path.resolve(cwd, relativePath);
  if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) {
    return false;
  }
  try {
    await fs.access(resolved, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
};
