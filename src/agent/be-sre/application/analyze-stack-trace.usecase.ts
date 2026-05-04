import * as fs from 'node:fs/promises';
import { join } from 'node:path';

import { Injectable, Logger } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { BuildCodeGraphUsecase } from '../../../code-graph/application/build-code-graph.usecase';
import { CodeGraphQueryUsecase } from '../../../code-graph/application/code-graph-query.usecase';
import { CodeGraphSnapshot } from '../../../code-graph/domain/code-graph.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { BeSreException } from '../domain/be-sre.exception';
import {
  AnalyzeStackTraceInput,
  SreAnalysis,
  StackFrame,
} from '../domain/be-sre.type';
import { BeSreErrorCode } from '../domain/be-sre-error-code.enum';
import { parseSreAnalysis } from '../domain/prompt/be-sre.parser';
import { BE_SRE_SYSTEM_PROMPT } from '../domain/prompt/be-sre-system.prompt';
import { parseStackTrace } from '../infrastructure/stack-trace-parser';

// prompt 에 포함할 영향 파일 최대 개수.
const PROMPT_AFFECTED_FILE_LIMIT = 20;

// 파일당 head 200줄 이내만 prompt 에 포함 — context window 절약.
const SOURCE_LINES_CAP = 200;

// codex P2 — usecase 진입 전 입력 정상화 한도. Slack handler 의 cap 외 추가 안전망.
const INPUT_BYTE_CAP = 50_000;
// eslint-disable-next-line no-control-regex -- ANSI escape (CSI sequence) 제거가 본 패턴의 의도.
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
// codex P2 — Bearer header / api_key=... / token=... / password=... / secret=... 패턴 redact.
// stack 안에 비밀번호/토큰 노출 시 DB / LLM 으로 유출되는 것을 방지.
const SECRET_PATTERN =
  /(Bearer\s+\S+|(?:api[_-]?key|token|password|secret)\s*[=:]\s*\S+)/gi;

const sanitizeInput = (raw: string): string => {
  const stripped = raw.replace(ANSI_PATTERN, '');
  const buf = Buffer.from(stripped, 'utf8');
  const capped =
    buf.byteLength <= INPUT_BYTE_CAP
      ? stripped
      : buf.subarray(0, INPUT_BYTE_CAP).toString('utf8') + '\n[TRUNCATED]';
  return capped.replace(SECRET_PATTERN, '[REDACTED]');
};

const isInsideRepo = (target: string, repoRoot: string): boolean =>
  target === repoRoot || target.startsWith(repoRoot + '/');

@Injectable()
export class AnalyzeStackTraceUsecase {
  private readonly logger = new Logger(AnalyzeStackTraceUsecase.name);
  // be-schema 의 cachedCodeGraph 패턴 — 첫 호출 시 build, 이후 process 수명 동안 재사용.
  private cachedCodeGraph: Promise<CodeGraphSnapshot | null> | null = null;

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
    private readonly buildCodeGraphUsecase: BuildCodeGraphUsecase,
    private readonly codeGraphQueryUsecase: CodeGraphQueryUsecase,
  ) {}

  async execute({
    stackTrace,
    slackUserId,
    triggerType,
  }: AnalyzeStackTraceInput): Promise<AgentRunOutcome<SreAnalysis>> {
    // codex P2 — ANSI escape 제거 + byte cap + 비밀 redact 후 진입.
    // redacted 본문이 inputSnapshot / evidence / prompt 모두에 일관 사용된다.
    const trimmed = sanitizeInput(stackTrace.trim());

    if (trimmed.length === 0) {
      throw new BeSreException({
        code: BeSreErrorCode.EMPTY_STACK_TRACE,
        message:
          'stack trace 가 비어 있습니다. `/be-sre <stack trace 전체 paste>` 형식으로 입력해주세요.',
        status: DomainStatus.BAD_REQUEST,
      });
    }

    const frames = parseStackTrace(trimmed);

    if (frames.length === 0) {
      throw new BeSreException({
        code: BeSreErrorCode.NO_TS_FRAMES_FOUND,
        message:
          'TypeScript/JavaScript frame 을 찾을 수 없습니다. node_modules 와 dist 를 제외한 .ts/.js 파일 경로가 포함된 stack trace 를 붙여넣어주세요.',
        status: DomainStatus.BAD_REQUEST,
      });
    }

    const affectedFiles = await this.findAffectedFiles(frames);
    // codex P1 — loadSourcePreviews 는 stack frame 의 절대 경로를 그대로 read 할 수 있어,
    // 조작된 stack 으로 호스트 파일 (예: /etc/passwd, .env) 이 LLM 에 유출될 수 있다.
    // realpath + repo root 검증을 위해 repoRoot 를 먼저 한 번 확정한다.
    const repoRoot = await fs.realpath(process.cwd());

    return this.agentRunService.execute({
      agentType: AgentType.BE_SRE,
      triggerType: triggerType ?? TriggerType.SLACK_COMMAND_BE_SRE,
      // /retry-run 이 stackTrace 로 동일 분석을 재실행할 수 있도록 trimmed 그대로 보존.
      // handler 단계에서 50KB byte cap 이 적용된 상태.
      inputSnapshot: {
        stackTrace: trimmed,
        stackTraceLength: trimmed.length,
        frameCount: frames.length,
        affectedFileCount: affectedFiles.length,
        slackUserId,
      },
      evidence: [
        {
          sourceType: 'SLACK_COMMAND_BE_SRE',
          sourceId: slackUserId,
          payload: { stackTrace: trimmed },
        },
        {
          sourceType: 'STACK_TRACE',
          sourceId: 'stack-trace',
          payload: { frames, affectedFiles },
        },
      ],
      run: async () => {
        const sourcePreviews = await loadSourcePreviews(
          affectedFiles,
          repoRoot,
        );
        const prompt = buildPrompt({
          stackTrace: trimmed,
          frames,
          affectedFiles,
          sourcePreviews,
        });
        const completion = await this.modelRouter.route({
          agentType: AgentType.BE_SRE,
          request: { prompt, systemPrompt: BE_SRE_SYSTEM_PROMPT },
        });
        const llmFields = parseSreAnalysis(completion.text);
        this.logger.log(
          `be-sre 분석 완료 — frames: ${frames.length}, affectedFiles: ${affectedFiles.length}`,
        );
        // 서버 주입 — affectedFiles 는 항상 server-side Code Graph query 결과로 채움 (BE-Schema 패턴).
        const result: SreAnalysis = {
          stackTrace: trimmed,
          frames,
          affectedFiles,
          ...llmFields,
        };
        return {
          result,
          modelUsed: completion.modelUsed,
          output: result,
        };
      },
    });
  }

  private async findAffectedFiles(frames: StackFrame[]): Promise<string[]> {
    const snapshot = await this.getCachedCodeGraph();

    const filePaths = dedupFilePaths(frames);

    if (!snapshot) {
      // Code Graph build 실패 시 frame 의 filePath 만 반환 (graceful lite 동작).
      return filePaths;
    }

    // frame 의 각 파일에 대해 caller 들을 수집해 surface 확장.
    const callerFiles = new Set<string>(filePaths);
    for (const frame of frames) {
      if (!frame.function) {
        continue;
      }
      const callSites = this.codeGraphQueryUsecase.findCallersOf({
        snapshot,
        functionName: frame.function,
      });
      for (const site of callSites) {
        callerFiles.add(site.filePath);
      }
    }

    return Array.from(callerFiles);
  }

  private async getCachedCodeGraph(): Promise<CodeGraphSnapshot | null> {
    if (this.cachedCodeGraph) {
      return this.cachedCodeGraph;
    }
    this.cachedCodeGraph = this.buildCodeGraphUsecase
      .execute({ rootDir: join(process.cwd(), 'src') })
      .catch((error: unknown) => {
        this.logger.warn(
          `Code Graph build 실패 — affectedFiles 는 frames 에서만 수집: ${error instanceof Error ? error.message : String(error)}`,
        );
        // 다음 호출에 재시도 가능하도록 cache 무효화.
        this.cachedCodeGraph = null;
        return null;
      });
    return this.cachedCodeGraph;
  }
}

const dedupFilePaths = (frames: StackFrame[]): string[] => {
  const seen = new Set<string>();
  for (const frame of frames) {
    if (frame.filePath) {
      seen.add(frame.filePath);
    }
  }
  return Array.from(seen);
};

// 영향 파일들의 source 를 head 200 줄씩 읽어 prompt 에 포함.
// codex P1 — frame 의 filePath 는 신뢰 불가 (사용자가 paste 한 stack trace 에서 옴).
// realpath 로 resolve 후 repo root 안인지 확인. 외부 / 접근 불가 / 실패 모두 silent skip.
const loadSourcePreviews = async (
  filePaths: string[],
  repoRoot: string,
): Promise<Record<string, string>> => {
  const previews: Record<string, string> = {};
  const head = filePaths.slice(0, PROMPT_AFFECTED_FILE_LIMIT);
  await Promise.all(
    head.map(async (filePath) => {
      try {
        const resolved = await fs.realpath(filePath);
        if (!isInsideRepo(resolved, repoRoot)) {
          return;
        }
        const raw = await fs.readFile(resolved, 'utf8');
        const lines = raw.split('\n').slice(0, SOURCE_LINES_CAP);
        previews[filePath] = lines.join('\n');
      } catch {
        // 파일 접근 불가 / repo 밖 / realpath 실패 — 분석은 계속.
      }
    }),
  );
  return previews;
};

const buildPrompt = ({
  stackTrace,
  frames,
  affectedFiles,
  sourcePreviews,
}: {
  stackTrace: string;
  frames: StackFrame[];
  affectedFiles: string[];
  sourcePreviews: Record<string, string>;
}): string => {
  const lines: string[] = [
    '[Stack Trace]',
    '```',
    stackTrace,
    '```',
    '',
    `[파싱된 Frame 들 (${frames.length}개)]`,
    ...frames.map(
      (f) =>
        `- ${f.function ?? '(anonymous)'} @ ${f.filePath ?? ''}:${f.line ?? '?'}`,
    ),
  ];

  if (affectedFiles.length > 0) {
    const head = affectedFiles.slice(0, PROMPT_AFFECTED_FILE_LIMIT);
    const omitted = affectedFiles.length - head.length;
    lines.push(
      '',
      `[영향 받는 파일 ${affectedFiles.length}개${omitted > 0 ? ` (상위 ${head.length}개만 표시)` : ''}]`,
      ...head.map((p) => `- ${p}`),
    );
    if (omitted > 0) {
      lines.push(`... (${omitted}개 추가 생략)`);
    }
  }

  const previewEntries = Object.entries(sourcePreviews);
  if (previewEntries.length > 0) {
    lines.push('', '[코드 미리보기 (파일당 최대 200줄)]');
    for (const [filePath, source] of previewEntries) {
      lines.push('', `## ${filePath}`, '```typescript', source, '```');
    }
  }

  lines.push(
    '',
    '[분석 지시]',
    '위 stack trace 와 코드를 보고 근본 원인 가설과 최소 변경 patch 를 JSON 으로 응답하라.',
  );

  return lines.join('\n');
};
