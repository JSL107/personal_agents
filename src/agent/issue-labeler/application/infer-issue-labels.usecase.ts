import { Injectable, Logger } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { IssueLabelerException } from '../domain/issue-labeler.exception';
import {
  InferIssueLabelsInput,
  IssueLabelInference,
  RepoLabelOption,
} from '../domain/issue-labeler.type';
import { IssueLabelerErrorCode } from '../domain/issue-labeler-error-code.enum';
import { parseIssueLabelInference } from '../domain/prompt/issue-labeler.parser';
import { ISSUE_LABELER_SYSTEM_PROMPT } from '../domain/prompt/issue-labeler-system.prompt';

// prompt 폭발 방지 — issue body 본문 head 만 자른다 (~1000 토큰 정도).
const BODY_MAX_BYTES = 4_000;
// vocab 폭발 방지 — repo 가 수백 개 label 을 갖는 경우 prompt 가 비대. 상위 N 만 노출.
// 일반 OSS repo 가 30~60 label 수준이라 100 이면 충분, monorepo 거대 vocab 안전망.
const VOCAB_MAX_COUNT = 100;
// reasoning 도 caller (consumer) 가 Slack DM/log 로 보낼 수 있어 본문이 너무 길지 않게 cap.
const REASONING_MAX_BYTES = 1_000;

@Injectable()
export class InferIssueLabelsUsecase {
  private readonly logger = new Logger(InferIssueLabelsUsecase.name);

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
  ) {}

  async execute(
    input: InferIssueLabelsInput,
  ): Promise<AgentRunOutcome<IssueLabelInference>> {
    const trimmedTitle = input.title.trim();
    if (trimmedTitle.length === 0) {
      throw new IssueLabelerException({
        code: IssueLabelerErrorCode.EMPTY_INPUT,
        message: 'issue title 이 비어 있어 라벨링을 진행할 수 없습니다.',
        status: DomainStatus.BAD_REQUEST,
      });
    }
    if (input.availableLabels.length === 0) {
      throw new IssueLabelerException({
        code: IssueLabelerErrorCode.NO_REPO_LABELS,
        message: `repo "${input.repo}" 에 사용 가능한 label 이 없어 라벨링을 건너뜁니다.`,
        status: DomainStatus.NOT_FOUND,
      });
    }

    const cappedLabels = input.availableLabels.slice(0, VOCAB_MAX_COUNT);
    const truncatedBody = truncateUtf8(input.body ?? '', BODY_MAX_BYTES);
    const prompt = buildPrompt({
      repo: input.repo,
      issueNumber: input.issueNumber,
      title: trimmedTitle,
      body: truncatedBody,
      availableLabels: cappedLabels,
    });

    return this.agentRunService.execute({
      agentType: AgentType.ISSUE_LABELER,
      triggerType: TriggerType.WEBHOOK_ISSUE_AUTO_LABEL,
      inputSnapshot: {
        repo: input.repo,
        issueNumber: input.issueNumber,
        title: trimmedTitle,
        bodyByteLen: Buffer.byteLength(input.body ?? '', 'utf8'),
        vocabSize: input.availableLabels.length,
        vocabCapApplied: input.availableLabels.length > VOCAB_MAX_COUNT,
      },
      evidence: [
        {
          sourceType: 'GITHUB_ISSUE_OPENED',
          sourceId: `${input.repo}#${input.issueNumber}`,
          payload: { title: trimmedTitle, body: truncatedBody },
        },
      ],
      run: async () => {
        const completion = await this.modelRouter.route({
          agentType: AgentType.ISSUE_LABELER,
          request: { prompt, systemPrompt: ISSUE_LABELER_SYSTEM_PROMPT },
        });
        const raw = parseIssueLabelInference(completion.text);
        const filtered = filterVocabAndCap({
          inference: raw,
          vocab: cappedLabels,
        });
        return {
          result: filtered,
          modelUsed: completion.modelUsed,
          output: filtered,
        };
      },
    });
  }
}

// LLM 이 vocab 외 label / 중복 label 을 뱉어도 caller (octokit addLabels) 가 422 떨어지지 않도록
// 본 함수가 안전망 — vocab 안 + 대소문자 정확 일치만 통과, 중복 제거, 최대 5개로 cap.
// reasoning 도 prompt 응답이 길 경우 cap.
const filterVocabAndCap = ({
  inference,
  vocab,
}: {
  inference: IssueLabelInference;
  vocab: RepoLabelOption[];
}): IssueLabelInference => {
  const vocabSet = new Set(vocab.map((l) => l.name));
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const label of inference.labels) {
    if (!vocabSet.has(label)) {
      continue;
    }
    if (seen.has(label)) {
      continue;
    }
    seen.add(label);
    deduped.push(label);
    if (deduped.length >= 5) {
      break;
    }
  }
  return {
    labels: deduped,
    reasoning: truncateUtf8(inference.reasoning, REASONING_MAX_BYTES),
  };
};

const buildPrompt = ({
  repo,
  issueNumber,
  title,
  body,
  availableLabels,
}: {
  repo: string;
  issueNumber: number;
  title: string;
  body: string;
  availableLabels: RepoLabelOption[];
}): string => {
  const vocabLines = availableLabels.map((l) => {
    const desc = l.description?.trim();
    return desc ? `- ${l.name} — ${desc}` : `- ${l.name}`;
  });
  return [
    `[repo]`,
    repo,
    '',
    `[issue ${issueNumber}]`,
    `Title: ${title}`,
    '',
    `Body:`,
    body.length > 0 ? body : '(본문 없음)',
    '',
    `[사용 가능한 라벨 vocab (이 안에서만 골라야 함)]`,
    ...vocabLines,
    '',
    `위 issue 에 적합한 label 부분집합을 JSON 한 줄로 출력하세요.`,
  ].join('\n');
};

const truncateUtf8 = (text: string, maxBytes: number): string => {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.byteLength <= maxBytes) {
    return text;
  }
  const sliced = buffer
    .subarray(0, maxBytes)
    .toString('utf8')
    .replace(/�$/, '');
  return `${sliced}\n... (생략됨 — cap ${maxBytes} bytes)`;
};
