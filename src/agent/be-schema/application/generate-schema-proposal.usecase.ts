import { join } from 'node:path';

import { Inject, Injectable, Logger } from '@nestjs/common';

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
import { BeSchemaException } from '../domain/be-schema.exception';
import {
  GenerateSchemaProposalInput,
  SchemaProposal,
} from '../domain/be-schema.type';
import { BeSchemaErrorCode } from '../domain/be-schema-error-code.enum';
import {
  SCHEMA_FILE_READER_PORT,
  SchemaFileReaderPort,
} from '../domain/port/schema-file.reader.port';
import { parseSchemaProposal } from '../domain/prompt/be-schema.parser';
import { BE_SCHEMA_SYSTEM_PROMPT } from '../domain/prompt/be-schema-system.prompt';

// 큰 schema 가 들어와도 prompt cap 을 단독으로 깨지 않도록 안전 한도.
// 이대리 schema 는 현재 100~200 줄 수준이라 여유 있음.
const SCHEMA_TEXT_BYTE_CAP = 12_000;

// V3 SOTA Foundation 1.1 단계 5 — Code Graph query 의 import path. 이대리는 Prisma 만 사용하므로
// `@prisma/client` import 한 파일이 schema 변경의 1차 영향 surface.
const PRISMA_CLIENT_IMPORT = '@prisma/client';

// affectedFiles 가 너무 많으면 prompt cap 을 압도할 수 있어 head 일부만 prompt 에 노출.
const PROMPT_AFFECTED_FILE_LIMIT = 30;

@Injectable()
export class GenerateSchemaProposalUsecase {
  private readonly logger = new Logger(GenerateSchemaProposalUsecase.name);
  // V3 단계 5 — Code Graph snapshot 의 process-life cache.
  // 매 호출마다 src/ 100+ 파일을 walk + parse 하면 5~15초 latency 추가돼 Slack 19초 SLA 위협.
  // singleton Injectable 이라 instance 보존 — 첫 호출 시 build, 이후 재사용. 코드 변경 후 재반영은
  // 개발 hot reload (nest start --watch) 가 process 재시작이라 자동 갱신됨.
  private cachedCodeGraph: Promise<CodeGraphSnapshot | null> | null = null;

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
    @Inject(SCHEMA_FILE_READER_PORT)
    private readonly schemaFileReader: SchemaFileReaderPort,
    private readonly buildCodeGraphUsecase: BuildCodeGraphUsecase,
    private readonly codeGraphQueryUsecase: CodeGraphQueryUsecase,
  ) {}

  async execute({
    request,
    slackUserId,
    triggerType,
  }: GenerateSchemaProposalInput): Promise<AgentRunOutcome<SchemaProposal>> {
    const trimmed = request.trim();
    if (trimmed.length === 0) {
      throw new BeSchemaException({
        code: BeSchemaErrorCode.EMPTY_REQUEST,
        message:
          '스키마 변경 요청이 비어 있습니다. `/be-schema <자연어 요청>` 형식으로 입력해주세요.',
        status: DomainStatus.BAD_REQUEST,
      });
    }

    const schemaText = await this.schemaFileReader.readSchema();
    const truncated = truncateSchemaText(schemaText, SCHEMA_TEXT_BYTE_CAP);

    // V3 단계 5 — Code Graph query: @prisma/client 를 사용하는 파일 list.
    // build 실패 시 빈 배열로 진행 (graceful) — schema 제안 자체는 lite 단계처럼 동작.
    const affectedFiles = await this.findAffectedFiles();

    return this.agentRunService.execute({
      agentType: AgentType.BE_SCHEMA,
      triggerType: triggerType ?? TriggerType.SLACK_COMMAND_BE_SCHEMA,
      inputSnapshot: {
        request: trimmed,
        slackUserId,
        schemaByteLength: Buffer.byteLength(schemaText, 'utf8'),
        schemaTruncated: truncated.truncated,
        // /quota 통계용 — Code Graph 사용 추적.
        affectedFileCount: affectedFiles.length,
      },
      evidence: [
        {
          sourceType: 'SLACK_COMMAND_BE_SCHEMA',
          sourceId: slackUserId,
          payload: { request: trimmed },
        },
        {
          sourceType: 'PRISMA_SCHEMA',
          sourceId: 'prisma/schema.prisma',
          excerpt: truncated.text.slice(0, 4_000),
          payload: {
            byteLength: Buffer.byteLength(schemaText, 'utf8'),
            truncated: truncated.truncated,
          },
        },
        {
          sourceType: 'CODE_GRAPH_AFFECTED_FILES',
          sourceId: PRISMA_CLIENT_IMPORT,
          payload: { count: affectedFiles.length, files: affectedFiles },
        },
      ],
      run: async () => {
        const prompt = buildPrompt({
          request: trimmed,
          schemaText: truncated.text,
          affectedFiles,
        });
        const completion = await this.modelRouter.route({
          agentType: AgentType.BE_SCHEMA,
          request: { prompt, systemPrompt: BE_SCHEMA_SYSTEM_PROMPT },
        });
        const parsed = parseSchemaProposal(trimmed, completion.text);
        // 서버 주입 — LLM 이 echo 한 affectedFiles 는 parser 가 [] 로 reset 하고 여기서 실제 query 결과로 덮어씀.
        const proposal: SchemaProposal = { ...parsed, affectedFiles };
        return {
          result: proposal,
          modelUsed: completion.modelUsed,
          output: proposal,
        };
      },
    });
  }

  private async findAffectedFiles(): Promise<string[]> {
    const snapshot = await this.getCachedCodeGraph();
    if (!snapshot) {
      return [];
    }
    return this.codeGraphQueryUsecase.findFilesAffectedByImport({
      snapshot,
      importPath: PRISMA_CLIENT_IMPORT,
    });
  }

  private async getCachedCodeGraph(): Promise<CodeGraphSnapshot | null> {
    if (this.cachedCodeGraph) {
      return this.cachedCodeGraph;
    }
    this.cachedCodeGraph = this.buildCodeGraphUsecase
      .execute({ rootDir: join(process.cwd(), 'src') })
      .catch((error: unknown) => {
        this.logger.warn(
          `Code Graph build 실패 — affectedFiles 없이 진행: ${error instanceof Error ? error.message : String(error)}`,
        );
        // 다음 호출에 재시도 가능하도록 cache 무효화.
        this.cachedCodeGraph = null;
        return null;
      });
    return this.cachedCodeGraph;
  }
}

const buildPrompt = ({
  request,
  schemaText,
  affectedFiles,
}: {
  request: string;
  schemaText: string;
  affectedFiles: string[];
}): string => {
  const lines = [
    '[자연어 요청]',
    request,
    '',
    '[현재 prisma/schema.prisma]',
    '```prisma',
    schemaText,
    '```',
  ];
  if (affectedFiles.length > 0) {
    const head = affectedFiles.slice(0, PROMPT_AFFECTED_FILE_LIMIT);
    const omitted = affectedFiles.length - head.length;
    lines.push(
      '',
      `[Code Graph — @prisma/client 를 import 하는 파일 ${affectedFiles.length}개${omitted > 0 ? ` (상위 ${head.length}개만 표시)` : ''}]`,
      ...head.map((p) => `- ${p}`),
    );
    if (omitted > 0) {
      lines.push(`... (${omitted}개 추가 생략)`);
    }
  }
  return lines.join('\n');
};

const truncateSchemaText = (
  text: string,
  capBytes: number,
): { text: string; truncated: boolean } => {
  const buf = Buffer.from(text, 'utf8');
  if (buf.byteLength <= capBytes) {
    return { text, truncated: false };
  }
  // tail 만 남겨도 됨 — schema 는 model 별 독립이라 머리/꼬리 어느 쪽이든 정보 손실 비슷.
  // 여기서는 head 보존: 의존 model 의 정의가 위쪽에 있을 가능성이 약간 더 높음.
  return {
    text: `${buf.subarray(0, capBytes).toString('utf8')}\n// (생략됨 — schema 본문이 ${capBytes} bytes 초과)`,
    truncated: true,
  };
};
