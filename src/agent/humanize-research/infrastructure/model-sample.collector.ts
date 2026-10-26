import { Injectable } from '@nestjs/common';

import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import {
  AgentType,
  ModelProviderName,
} from '../../../model-router/domain/model-router.type';
import { statusOfItems } from '../domain/humanize-research.constant';
import {
  CollectionResult,
  CollectionStatus,
  HumanizeResearchSource,
  SampleOutcome,
  SampleTopic,
} from '../domain/humanize-research.type';

const SAMPLE_TOPICS: SampleTopic[] = [
  {
    key: 'development-retrospective',
    prompt:
      '개발 회고 블로그 글을 약 800자로 써 주세요. 작은 기능을 출시한 뒤 예상과 달리 운영 로그에서 병목을 발견하고, 팀이 원인을 좁혀 수정한 경험을 구체적으로 설명하세요.',
  },
  {
    key: 'technical-explanation',
    prompt:
      '기술 설명 블로그 글을 약 800자로 써 주세요. 비동기 작업 큐에서 재시도와 멱등성의 관계를 예시로 설명하고, 실제 구현에서 주의할 점을 적으세요.',
  },
  {
    key: 'work-journal',
    prompt:
      '작업 일지 블로그 글을 약 800자로 써 주세요. 테스트 실패를 재현하고 원인을 찾은 하루를 시간 흐름에 따라 기록하되, 판단이 바뀐 순간과 남은 일을 포함하세요.',
  },
];

const SAMPLE_PROVIDERS = [ModelProviderName.CHATGPT, ModelProviderName.CLAUDE];

const SAMPLE_SYSTEM_PROMPT =
  '한국어 블로그 글의 실제 문체를 관찰하기 위한 표본을 작성하라. 요청한 주제의 글 본문만 반환하라.';

@Injectable()
export class ModelSampleCollector {
  constructor(private readonly modelRouter: ModelRouterUsecase) {}

  async collect(): Promise<CollectionResult> {
    const jobs = SAMPLE_PROVIDERS.flatMap((provider) =>
      SAMPLE_TOPICS.map((topic) => ({ provider, topic })),
    );
    // CLI 자식 프로세스 6개를 한꺼번에 띄우지 않으려고 차례로 부른다.
    const outcomes: SampleOutcome[] = [];
    for (const job of jobs) {
      outcomes.push(await this.sampleOne(job));
    }
    const items = outcomes.flatMap(({ item }) => (item ? [item] : []));
    const failures = outcomes.flatMap(({ failure }) =>
      failure ? [failure] : [],
    );
    const hasFailure = failures.length > 0;
    return {
      source: HumanizeResearchSource.SAMPLE,
      status: hasFailure ? CollectionStatus.FAILED : statusOfItems(items),
      items,
      ...(hasFailure ? { error: failures.join('; ') } : {}),
    };
  }

  private async sampleOne({
    provider,
    topic,
  }: {
    provider: ModelProviderName;
    topic: SampleTopic;
  }): Promise<SampleOutcome> {
    const label = `${provider}:${topic.key}`;
    try {
      // 계약 머리말과 fallback 은 표본 문체·출처 provider 를 바꾸므로 둘 다 끈다.
      const response = await this.modelRouter.route({
        agentType: AgentType.HUMANIZE_RESEARCH,
        provider,
        noFallback: true,
        noContractPreamble: true,
        request: {
          systemPrompt: SAMPLE_SYSTEM_PROMPT,
          prompt: topic.prompt,
        },
      });
      const text = response.text.trim();
      if (text.length === 0) {
        return { failure: `${label}: 빈 응답` };
      }
      const item = {
        id: `sample:${label}`,
        source: HumanizeResearchSource.SAMPLE,
        text,
      };
      return { item };
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      return { failure: `${label}: ${reason}` };
    }
  }
}
