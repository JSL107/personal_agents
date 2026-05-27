import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  SANDBOX_RUNNER_PORT,
  SandboxRunnerPort,
  SandboxRunResult,
} from '../../../sandbox/domain/port/sandbox-runner.port';
import { SandboxException } from '../../../sandbox/domain/sandbox.exception';
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

// V3 §8 self-correction 단계 2 (plan: docs/superpowers/plans/2026-05-05-be-test-self-correction-revival.md).
// MVP (codex P1) 에서 sandbox 의존을 제거한 이유는 호스트 fs 변조 위험이었고, sandbox tmpfs 주입이
// 끝나 그 위험 없이 in-memory 로 spec 을 검증할 수 있게 된 시점에 재도입.
//
// 보강 (omc:critic / codex 지적 반영):
// - jest 옵션: `--cacheDirectory=/work/.jest-cache --no-coverage` 하드코딩.
//   `--rootDir=/repo` 가 `:ro` 라 jest cache write 시도 시 EROFS 로 즉사. cache 만 tmpfs 분리.
//   `--passWithNoTests` 는 의도적으로 미설정 — spec 자체가 없으면 fail 로 잡혀야 retry 가치.
// - stderr 패턴 기반 retryable 분류 — TS compile / import 에러는 retry 가치, jest assertion fail 은
//   구조적 오해라 동일 spec 재생산 확률이 높아 1 회만 추가 retry 후 NON_RETRYABLE stop.
// - sandbox 자체 에러 (DOCKER_SPAWN_FAILED / timedOut) 는 재시도 X → validated:false + SANDBOX_UNAVAILABLE.
const MAX_SELF_CORRECTION_ATTEMPTS = 3;
const STDERR_TAIL_BYTES = 1024;
const SANDBOX_TIMEOUT_MS = 90_000;
const TMPFS_SPEC_PATH = '/work/generated.spec.ts';

@Injectable()
export class GenerateTestUsecase {
  private readonly logger = new Logger(GenerateTestUsecase.name);

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
    private readonly analyzer: TreeSitterTestAnalyzer,
    private readonly mockGenerator: JestMockGenerator,
    @Inject(SANDBOX_RUNNER_PORT)
    private readonly sandboxRunner: SandboxRunnerPort,
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
        const result = await this.generateWithSelfCorrection({
          analysis,
          mockSetup,
          repoRoot,
          resolvedPath,
        });
        this.logger.log(
          `be-test 결과 — ${resolvedPath} validated=${result.test.validated} attempts=${result.test.selfCorrectionAttempts} stop=${result.test.selfCorrectionStopReason ?? 'NONE'}`,
        );
        return {
          result: result.test,
          modelUsed: result.modelUsed,
          output: result.test,
        };
      },
    });
  }

  private async generateWithSelfCorrection({
    analysis,
    mockSetup,
    repoRoot,
    resolvedPath,
  }: {
    analysis: FileAnalysis;
    mockSetup: string;
    repoRoot: string;
    resolvedPath: string;
  }): Promise<{ test: GeneratedTest; modelUsed: string }> {
    const initialCompletion = await this.modelRouter.route({
      agentType: AgentType.BE_TEST,
      request: {
        prompt: buildInitialPrompt({ analysis, mockSetup }),
        systemPrompt: BE_TEST_SYSTEM_PROMPT,
      },
    });
    let specCode = parseSpecCode(initialCompletion.text).specCode;
    let modelUsed = initialCompletion.modelUsed;
    let lastStderr = '';
    let validated = false;
    let stopReason: GeneratedTest['selfCorrectionStopReason'] = undefined;
    let nonRetryableHits = 0;
    let attempts = 0;

    for (
      let attempt = 1;
      attempt <= MAX_SELF_CORRECTION_ATTEMPTS;
      attempt += 1
    ) {
      attempts = attempt;
      let runResult: SandboxRunResult;
      try {
        runResult = await this.sandboxRunner.run({
          command:
            `pnpm jest ${TMPFS_SPEC_PATH} --rootDir=/repo ` +
            `--cacheDirectory=/work/.jest-cache --no-coverage`,
          hostMountPath: repoRoot,
          mountMode: 'ro',
          networkMode: 'none',
          timeoutMs: SANDBOX_TIMEOUT_MS,
          tmpfsFiles: [{ containerPath: TMPFS_SPEC_PATH, content: specCode }],
        });
      } catch (error) {
        // sandbox 자체 실패 (DOCKER_SPAWN_FAILED 등) — retry 가치 없음, validated:false 로 즉시 종료.
        const message =
          error instanceof SandboxException ? error.message : String(error);
        this.logger.warn(
          `be-test sandbox 호출 실패 — ${resolvedPath} attempt=${attempt}: ${message}`,
        );
        stopReason = 'SANDBOX_UNAVAILABLE';
        lastStderr = message;
        break;
      }

      if (runResult.exitCode === 0 && !runResult.timedOut) {
        validated = true;
        stopReason = 'PASSED';
        break;
      }

      lastStderr = runResult.stderr;

      // jest assertion fail 처럼 동일 구조 LLM 재생성으로 회복 가능성 낮은 패턴은 1 회 retry 후 stop.
      if (isNonRetryableStderr(runResult.stderr)) {
        nonRetryableHits += 1;
      }

      if (attempt === MAX_SELF_CORRECTION_ATTEMPTS) {
        stopReason = 'MAX_ATTEMPTS_EXHAUSTED';
        break;
      }

      if (nonRetryableHits >= 2) {
        stopReason = 'NON_RETRYABLE';
        break;
      }

      this.logger.log(
        `be-test self-correction attempt=${attempt} 실패 — 다음 attempt 진행`,
      );

      const fixCompletion = await this.modelRouter.route({
        agentType: AgentType.BE_TEST,
        request: {
          prompt: buildFixPrompt({
            analysis,
            mockSetup,
            previousSpec: specCode,
            stderr: runResult.stderr,
            stdout: runResult.stdout,
          }),
          systemPrompt: BE_TEST_SYSTEM_PROMPT,
        },
      });
      specCode = parseSpecCode(fixCompletion.text).specCode;
      modelUsed = fixCompletion.modelUsed;
    }

    const test: GeneratedTest = {
      filePath: resolvedPath,
      specCode,
      validated,
      selfCorrectionAttempts: attempts,
      selfCorrectionStderrTail: validated
        ? undefined
        : tailBytes(lastStderr, STDERR_TAIL_BYTES),
      selfCorrectionStopReason: stopReason,
    };
    return { test, modelUsed };
  }
}

const isInsideRepo = (target: string, repoRoot: string): boolean =>
  target === repoRoot || target.startsWith(repoRoot + path.sep);

// stderr 에 jest assertion fail 표지 (`Expected:` / `Received:` 또는 `expect(...).<matcher>(`) 가 보이면
// LLM 재생성으로 회복 가능성이 낮다 (논리 오해이므로 동일 spec 재생산 확률 높음).
// TS compile / import 에러 (`TSxxxx:`, `Cannot find module`, `SyntaxError`) 는 retryable 로 본다.
const NON_RETRYABLE_STDERR_PATTERNS: RegExp[] = [
  /Expected:\s/,
  /Received:\s/,
  /expect\([^)]*\)\.[a-zA-Z]+\(/,
];
const isNonRetryableStderr = (stderr: string): boolean =>
  NON_RETRYABLE_STDERR_PATTERNS.some((pattern) => pattern.test(stderr));

const tailBytes = (text: string, maxBytes: number): string => {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.byteLength <= maxBytes) {
    return text;
  }
  return buffer.subarray(buffer.byteLength - maxBytes).toString('utf8');
};

const buildInitialPrompt = ({
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

// retry 단계 fix prompt — 직전 spec 과 sandbox stderr 를 제시하고 spec 전체 재생성을 지시.
// patch diff 형태는 사용하지 않음 (plan §3.2 — spec 자체 mutation 위험 회피).
const buildFixPrompt = ({
  analysis,
  mockSetup,
  previousSpec,
  stderr,
  stdout,
}: {
  analysis: FileAnalysis;
  mockSetup: string;
  previousSpec: string;
  stderr: string;
  stdout: string;
}): string => {
  const stderrSnippet = tailBytes(stderr, 2_000);
  const stdoutSnippet = tailBytes(stdout, 1_000);
  const lines = [
    buildInitialPrompt({ analysis, mockSetup }),
    '',
    '[직전 spec — 검증 실패]',
    '```typescript',
    previousSpec,
    '```',
    '',
    '[sandbox 실행 stderr (tail)]',
    '```',
    stderrSnippet,
    '```',
  ];
  if (stdoutSnippet.trim().length > 0) {
    lines.push('');
    lines.push('[sandbox 실행 stdout (tail)]');
    lines.push('```');
    lines.push(stdoutSnippet);
    lines.push('```');
  }
  lines.push('');
  lines.push('[수정 지시]');
  lines.push(
    '위 spec 이 sandbox 에서 실패했다. stderr 의 원인을 분석해 spec 전체를 다시 작성하라.',
  );
  lines.push(
    'patch diff 가 아니라 spec 전체를 새로 출력한다. import 와 Mock 구조 유지, 분기 커버리지 보존.',
  );
  return lines.join('\n');
};
