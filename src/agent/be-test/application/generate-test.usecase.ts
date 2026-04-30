import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { Injectable, Logger } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { BeTestException } from '../domain/be-test.exception';
import {
  FileAnalysis,
  GeneratedTest,
  GenerateTestInput,
} from '../domain/be-test.type';
import { BeTestErrorCode } from '../domain/be-test-error-code.enum';
import { parseSpecCode } from '../domain/prompt/be-test.parser';
import { BE_TEST_SYSTEM_PROMPT } from '../domain/prompt/be-test-system.prompt';
import { JestMockGenerator } from '../infrastructure/jest-mock-generator';
import { TreeSitterTestAnalyzer } from '../infrastructure/tree-sitter-test-analyzer';

// V3 mid-progress audit (codex P1) — LLM 이 생성한 spec 을 호스트 repo 에 작성한 뒤 sandbox 가
// 그걸 mount RW 로 실행하던 self-correction 루프는 호스트 파일 수정/삭제 위험과 spec path
// shell-interpolation 위험을 동시에 가졌다. MVP 는 spec 생성/반환만 수행하고 사용자가 직접
// 검증한다 — sandbox 격리 디자인이 강화되면 (read-only mount + tmpfs spec) 그때 self-correction
// 루프를 다시 도입한다.
@Injectable()
export class GenerateTestUsecase {
  private readonly logger = new Logger(GenerateTestUsecase.name);

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
    private readonly analyzer: TreeSitterTestAnalyzer,
    private readonly mockGenerator: JestMockGenerator,
  ) {}

  async execute({
    filePath,
    slackUserId,
    triggerType,
  }: GenerateTestInput): Promise<AgentRunOutcome<GeneratedTest>> {
    const trimmed = filePath.trim();

    if (trimmed.length === 0) {
      throw new BeTestException({
        code: BeTestErrorCode.EMPTY_PATH,
        message:
          '파일 경로가 비어 있습니다. `/be-test <파일경로>` 형식으로 입력해주세요.',
        status: DomainStatus.BAD_REQUEST,
      });
    }

    if (trimmed.includes('..')) {
      throw new BeTestException({
        code: BeTestErrorCode.INVALID_PATH,
        message: `경로에 '..' 가 포함되어 있어 처리할 수 없습니다: ${trimmed}`,
        status: DomainStatus.BAD_REQUEST,
      });
    }

    const repoRoot = await fs.realpath(process.cwd());
    const absPath = path.resolve(repoRoot, trimmed);

    if (!isInsideRepo(absPath, repoRoot)) {
      throw new BeTestException({
        code: BeTestErrorCode.INVALID_PATH,
        message: `경로가 repo root 밖을 가리킵니다: ${absPath}`,
        status: DomainStatus.BAD_REQUEST,
      });
    }

    // codex P2 — symlink 가 repo 밖을 가리키는 경우 startsWith 검증을 우회할 수 있어
    // realpath 로 한 번 더 검증한다. read-before-validate race 회피를 위해 read 전에 검증한다.
    let resolvedPath: string;
    try {
      resolvedPath = await fs.realpath(absPath);
    } catch {
      throw new BeTestException({
        code: BeTestErrorCode.FILE_NOT_FOUND,
        message: `파일을 찾을 수 없습니다: ${absPath}`,
        status: DomainStatus.NOT_FOUND,
      });
    }

    if (!isInsideRepo(resolvedPath, repoRoot)) {
      throw new BeTestException({
        code: BeTestErrorCode.INVALID_PATH,
        message: `symlink resolution 결과가 repo root 밖을 가리킵니다: ${resolvedPath}`,
        status: DomainStatus.BAD_REQUEST,
      });
    }

    let sourceCode: string;
    try {
      sourceCode = await fs.readFile(resolvedPath, 'utf8');
    } catch {
      throw new BeTestException({
        code: BeTestErrorCode.FILE_NOT_FOUND,
        message: `파일을 찾을 수 없습니다: ${absPath}`,
        status: DomainStatus.NOT_FOUND,
      });
    }

    const analysis = this.analyzer.analyze(resolvedPath, sourceCode);
    const mockSetup = this.mockGenerator.generateMocks(analysis.ports);

    return this.agentRunService.execute({
      agentType: AgentType.BE_TEST,
      triggerType: triggerType ?? TriggerType.SLACK_COMMAND_BE_TEST,
      // /retry-run 이 filePath 로 동일 파일을 재실행할 수 있도록 trimmed 그대로 보존.
      inputSnapshot: {
        filePath: trimmed,
        slackUserId,
        cyclomaticComplexity: analysis.cyclomaticComplexity,
        functionCount: analysis.functions.length,
        portCount: analysis.ports.length,
      },
      evidence: [
        {
          sourceType: 'SLACK_COMMAND_BE_TEST',
          sourceId: slackUserId,
          payload: { filePath: trimmed },
        },
        {
          sourceType: 'FILE_ANALYSIS',
          sourceId: resolvedPath,
          payload: {
            className: analysis.className,
            functionCount: analysis.functions.length,
            portCount: analysis.ports.length,
            cyclomaticComplexity: analysis.cyclomaticComplexity,
          },
        },
      ],
      run: async () => {
        const prompt = buildPrompt({ analysis, mockSetup });
        const completion = await this.modelRouter.route({
          agentType: AgentType.BE_TEST,
          request: { prompt, systemPrompt: BE_TEST_SYSTEM_PROMPT },
        });
        const { specCode } = parseSpecCode(completion.text);
        this.logger.log(`be-test spec 생성 — ${resolvedPath}`);
        const result: GeneratedTest = {
          filePath: resolvedPath,
          specCode,
          validated: false,
        };
        return {
          result,
          modelUsed: completion.modelUsed,
          output: result,
        };
      },
    });
  }
}

const isInsideRepo = (target: string, repoRoot: string): boolean =>
  target === repoRoot || target.startsWith(repoRoot + path.sep);

const buildPrompt = ({
  analysis,
  mockSetup,
}: {
  analysis: FileAnalysis;
  mockSetup: string;
}): string => {
  const lines: string[] = [
    '[파일 분석 결과 (JSON)]',
    JSON.stringify(
      {
        filePath: analysis.filePath,
        className: analysis.className,
        ports: analysis.ports,
        functions: analysis.functions.map((f) => ({
          name: f.name,
          isAsync: f.isAsync,
          parameters: f.parameters,
          branchCount: f.branches.length,
          branches: f.branches,
        })),
        cyclomaticComplexity: analysis.cyclomaticComplexity,
      },
      null,
      2,
    ),
    '',
  ];

  if (mockSetup.length > 0) {
    lines.push('[Mock 배치 힌트]');
    lines.push(mockSetup);
    lines.push('');
  }

  lines.push('[원본 소스]');
  lines.push('```typescript');
  lines.push(analysis.rawSource);
  lines.push('```');
  lines.push('');
  lines.push('[작성 지시]');
  lines.push(
    '위 파일의 모든 분기 경로를 커버하는 Jest spec 을 작성하라. describe/it 구조, given/when/then 패턴.',
  );

  return lines.join('\n');
};
