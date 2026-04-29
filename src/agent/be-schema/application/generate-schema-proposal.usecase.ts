import { Inject, Injectable } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
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

@Injectable()
export class GenerateSchemaProposalUsecase {
  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
    @Inject(SCHEMA_FILE_READER_PORT)
    private readonly schemaFileReader: SchemaFileReaderPort,
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

    return this.agentRunService.execute({
      agentType: AgentType.BE_SCHEMA,
      triggerType: triggerType ?? TriggerType.SLACK_COMMAND_BE_SCHEMA,
      inputSnapshot: {
        request: trimmed,
        slackUserId,
        schemaByteLength: Buffer.byteLength(schemaText, 'utf8'),
        schemaTruncated: truncated.truncated,
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
      ],
      run: async () => {
        const prompt = buildPrompt({
          request: trimmed,
          schemaText: truncated.text,
        });
        const completion = await this.modelRouter.route({
          agentType: AgentType.BE_SCHEMA,
          request: { prompt, systemPrompt: BE_SCHEMA_SYSTEM_PROMPT },
        });
        const proposal = parseSchemaProposal(trimmed, completion.text);
        return {
          result: proposal,
          modelUsed: completion.modelUsed,
          output: proposal,
        };
      },
    });
  }
}

const buildPrompt = ({
  request,
  schemaText,
}: {
  request: string;
  schemaText: string;
}): string =>
  [
    '[자연어 요청]',
    request,
    '',
    '[현재 prisma/schema.prisma]',
    '```prisma',
    schemaText,
    '```',
  ].join('\n');

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
