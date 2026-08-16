import * as path from 'node:path';

import { GenerateBackendPlanUsecase } from '../../agent/be/application/generate-backend-plan.usecase';
import { GenerateSchemaProposalUsecase } from '../../agent/be-schema/application/generate-schema-proposal.usecase';
import { GenerateTestUsecase } from '../../agent/be-test/application/generate-test.usecase';
import { Assignment } from '../../agent/cto/domain/cto.type';
import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  fileExistsRelativeToCwd,
  RunBeChainUsecase,
} from './run-be-chain.usecase';

const buildAssignment = (
  beAssignment: Assignment['beAssignment'],
  overrides: Partial<Assignment> = {},
): Assignment => ({
  taskId: overrides.taskId ?? 't1',
  taskTitle: overrides.taskTitle ?? 'task 제목',
  beAssignment,
  priority: overrides.priority ?? 2,
  reasoning: overrides.reasoning ?? '',
  confidence: overrides.confidence ?? 0.9,
  ...(overrides.targetFilePath !== undefined
    ? { targetFilePath: overrides.targetFilePath }
    : {}),
});

// BE_TEST 분배 시 CTO 가 추론한 path 의 실제 존재 검증. LLM hallucination 차단.
describe('fileExistsRelativeToCwd', () => {
  it('repo 에 실제 존재하는 파일 (package.json) 은 true', async () => {
    await expect(fileExistsRelativeToCwd('package.json')).resolves.toBe(true);
  });

  it('repo 안 하위 경로 (자기 자신 파일) 도 true', async () => {
    const selfPath = path.relative(
      process.cwd(),
      path.join(
        process.cwd(),
        'src/be-chain/application/run-be-chain.usecase.spec.ts',
      ),
    );
    await expect(fileExistsRelativeToCwd(selfPath)).resolves.toBe(true);
  });

  it('repo 에 없는 path 는 false (hallucination 케이스)', async () => {
    await expect(
      fileExistsRelativeToCwd('src/does/not/exist.service.ts'),
    ).resolves.toBe(false);
  });

  it('빈 문자열은 false', async () => {
    await expect(fileExistsRelativeToCwd('')).resolves.toBe(false);
  });

  it('absolute path 는 무조건 false (cwd 밖 접근 차단)', async () => {
    await expect(fileExistsRelativeToCwd('/etc/passwd')).resolves.toBe(false);
    await expect(fileExistsRelativeToCwd('/tmp')).resolves.toBe(false);
  });

  it('path traversal (../) 로 cwd 벗어나면 false', async () => {
    await expect(
      fileExistsRelativeToCwd('../../../../../etc/passwd'),
    ).resolves.toBe(false);
  });
});

describe('RunBeChainUsecase', () => {
  let backendPlanExecute: jest.Mock;
  let schemaProposalExecute: jest.Mock;
  let testExecute: jest.Mock;
  let setParentId: jest.Mock;
  let usecase: RunBeChainUsecase;

  beforeEach(() => {
    backendPlanExecute = jest.fn().mockResolvedValue({ agentRunId: 201 });
    schemaProposalExecute = jest.fn().mockResolvedValue({ agentRunId: 202 });
    testExecute = jest.fn().mockResolvedValue({ agentRunId: 203 });
    setParentId = jest.fn().mockResolvedValue(undefined);
    usecase = new RunBeChainUsecase(
      { execute: backendPlanExecute } as unknown as GenerateBackendPlanUsecase,
      {
        execute: schemaProposalExecute,
      } as unknown as GenerateSchemaProposalUsecase,
      { execute: testExecute } as unknown as GenerateTestUsecase,
      { setParentId } as unknown as AgentRunService,
    );
  });

  it('BE assignment 는 taskTitle 을 subject 로 BE plan usecase 에 위임', async () => {
    const outcomes = await usecase.execute({
      assignments: [
        buildAssignment(AgentType.BE, { taskTitle: 'Router 정리' }),
      ],
      slackUserId: 'U1',
      parentRunId: 100,
    });

    expect(backendPlanExecute).toHaveBeenCalledWith({
      subject: 'Router 정리',
      slackUserId: 'U1',
    });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe('OK');
    expect(outcomes[0].agentRunId).toBe(201);
  });

  it('실행된 worker run 은 CTO run 을 parentId 로 기록 (chain audit)', async () => {
    await usecase.execute({
      assignments: [buildAssignment(AgentType.BE)],
      slackUserId: 'U1',
      parentRunId: 100,
    });

    expect(setParentId).toHaveBeenCalledWith({ id: 201, parentId: 100 });
  });

  it('triggerType 지정 시 BE_SCHEMA 에 그대로 전달 (auto-flow 경로 보존)', async () => {
    await usecase.execute({
      assignments: [buildAssignment(AgentType.BE_SCHEMA)],
      slackUserId: 'U1',
      parentRunId: 100,
      triggerType: TriggerType.SLACK_COMMAND_AUTO_FLOW,
    });

    expect(schemaProposalExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: TriggerType.SLACK_COMMAND_AUTO_FLOW,
      }),
    );
  });

  it('triggerType 미지정 시 BE_SCHEMA 입력에 triggerType 키 자체를 안 넣는다', async () => {
    await usecase.execute({
      assignments: [buildAssignment(AgentType.BE_SCHEMA)],
      slackUserId: 'U1',
      parentRunId: 100,
    });

    expect(schemaProposalExecute.mock.calls[0][0]).not.toHaveProperty(
      'triggerType',
    );
  });

  it('BE_TEST 에 targetFilePath 가 없으면 실행하지 않고 SKIPPED', async () => {
    const outcomes = await usecase.execute({
      assignments: [buildAssignment(AgentType.BE_TEST)],
      slackUserId: 'U1',
      parentRunId: 100,
    });

    expect(testExecute).not.toHaveBeenCalled();
    expect(outcomes[0].status).toBe('SKIPPED');
  });

  it('BE_TEST 의 targetFilePath 가 repo 에 없으면 SKIPPED (hallucination 차단)', async () => {
    const outcomes = await usecase.execute({
      assignments: [
        buildAssignment(AgentType.BE_TEST, {
          targetFilePath: 'src/does/not/exist.service.ts',
        }),
      ],
      slackUserId: 'U1',
      parentRunId: 100,
    });

    expect(testExecute).not.toHaveBeenCalled();
    expect(outcomes[0].status).toBe('SKIPPED');
    expect(outcomes[0].message).toContain('실제 repo 에 없습니다');
  });

  it('BE_TEST 의 targetFilePath 가 실존하면 spec 생성 위임', async () => {
    const outcomes = await usecase.execute({
      assignments: [
        buildAssignment(AgentType.BE_TEST, { targetFilePath: 'package.json' }),
      ],
      slackUserId: 'U1',
      parentRunId: 100,
    });

    expect(testExecute).toHaveBeenCalledWith({
      filePath: 'package.json',
      slackUserId: 'U1',
    });
    expect(outcomes[0].status).toBe('OK');
  });

  // 한 건 실패로 나머지를 버리면 사용자는 무엇이 됐고 무엇이 안 됐는지 알 수 없다.
  it('중간 worker 가 throw 해도 나머지 assignment 는 계속 실행', async () => {
    backendPlanExecute.mockRejectedValueOnce(new Error('codex capacity'));

    const outcomes = await usecase.execute({
      assignments: [
        buildAssignment(AgentType.BE, { taskId: 'a1' }),
        buildAssignment(AgentType.BE_SCHEMA, { taskId: 'a2' }),
      ],
      slackUserId: 'U1',
      parentRunId: 100,
    });

    expect(outcomes).toHaveLength(2);
    expect(outcomes[0].status).toBe('FAILED');
    expect(outcomes[0].message).toContain('codex capacity');
    expect(outcomes[1].status).toBe('OK');
    expect(schemaProposalExecute).toHaveBeenCalledTimes(1);
  });

  // parentId 기록은 audit 부가 기능 — 실패해도 실행 결과를 OK 로 유지해야 한다.
  it('parentId 기록이 실패해도 outcome 은 OK 로 유지', async () => {
    setParentId.mockRejectedValue(new Error('P2025'));

    const outcomes = await usecase.execute({
      assignments: [buildAssignment(AgentType.BE)],
      slackUserId: 'U1',
      parentRunId: 100,
    });

    expect(outcomes[0].status).toBe('OK');
    expect(outcomes[0].agentRunId).toBe(201);
  });

  it('assignments 가 비어 있으면 아무 worker 도 호출하지 않는다', async () => {
    const outcomes = await usecase.execute({
      assignments: [],
      slackUserId: 'U1',
      parentRunId: 100,
    });

    expect(outcomes).toEqual([]);
    expect(backendPlanExecute).not.toHaveBeenCalled();
    expect(schemaProposalExecute).not.toHaveBeenCalled();
    expect(testExecute).not.toHaveBeenCalled();
  });
});
