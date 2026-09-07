import { Injectable, Logger } from '@nestjs/common';

import { extractJsonObjectText } from '../../../common/util/llm-json-extract.util';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { REVISION_CONVENTIONS_OUTPUT_SCHEMA } from '../domain/prompt/blog-publish.schema';
import {
  CONVENTION_SOURCE_LIMIT,
  MAX_CONVENTION_LENGTH,
  MAX_CONVENTIONS,
  MIN_SOURCE_POSTS,
} from '../domain/revision-conventions';
import { REVISION_WINDOW_DAYS } from '../domain/revision-rate';
import {
  BlogRevisionReport,
  BlogRevisionRow,
} from './measure-blog-revision.usecase';

export interface ExtractRevisionConventionsResult {
  conventions: string[];
  modelUsed: string;
}

interface ConventionModelOutput {
  conventions?: unknown;
}

/**
 * 실제로 줄이 바뀐 글인가.
 *
 * `count.percent` 로 거르면 안 된다 — 반올림이라 긴 글에서 한두 줄만 고친 회차가 0% 로
 * 떨어진다. 반대로 이 검사를 아예 빼면 「그대로 둔 글」만 셋인 주에 `(없음)` 뿐인 입력으로
 * 모델이 규칙을 지어내고, 그 규칙이 이후 모든 편집에 실린다. 실측상 한 회차 9편 중 3편이
 * 0% 였으므로 드문 경우가 아니다.
 */
const hasRevisedLines = (row: BlogRevisionRow): boolean =>
  (row.changes?.addedLines.length ?? 0) > 0 ||
  (row.changes?.removedLines.length ?? 0) > 0;

/**
 * 편집 계약을 이루는 식별자. 이 토큰을 언급하는 규칙은 버린다.
 *
 * 규칙은 모델이 만든 문장이 다음 모델의 system prompt 로 그대로 들어가는 자리다. 재료가
 * 사람이 고친 글이라 외부 공격 경로는 아니지만, 이 블로그가 다루는 주제가 에이전트·프롬프트라
 * 본문에 지시문처럼 읽히는 문장이 실린다. 그 문장이 규칙으로 일반화되면 「절대 건드리지 말
 * 것」의 보호 규칙과 충돌한다. 정상적인 편집 규칙에는 이 토큰들이 나올 이유가 없다.
 */
const CONTRACT_TOKENS = ['code_block', 'publishable', 'slug', 'json', '```'];

const mentionsContract = (convention: string): boolean => {
  const lowered = convention.toLowerCase();
  return CONTRACT_TOKENS.some((token) => lowered.includes(token));
};

@Injectable()
export class ExtractRevisionConventionsUsecase {
  private readonly logger = new Logger(ExtractRevisionConventionsUsecase.name);

  constructor(private readonly modelRouter: ModelRouterUsecase) {}

  async execute(
    report: BlogRevisionReport,
    now: Date,
  ): Promise<ExtractRevisionConventionsResult> {
    const rows = this.selectSourceRows(report.rows, now);
    if (rows.length < MIN_SOURCE_POSTS) {
      return { conventions: [], modelUsed: 'none' };
    }

    try {
      const completion = await this.modelRouter.route({
        agentType: AgentType.BLOG_REVISION,
        request: {
          prompt: this.buildPrompt(rows),
          systemPrompt:
            '반복 수정된 줄에서 편집 단계가 실행할 수 있는 규칙만 추출하라. 문체와 말투 규칙은 제외하라.',
          outputSchema: REVISION_CONVENTIONS_OUTPUT_SCHEMA,
        },
      });
      return {
        conventions: this.parseConventions(completion.text),
        modelUsed: completion.modelUsed,
      };
    } catch (error: unknown) {
      this.logger.warn(
        `블로그 수정 규칙 추출 실패, 규칙 없이 진행: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { conventions: [], modelUsed: 'none' };
    }
  }

  private selectSourceRows(
    rows: readonly BlogRevisionRow[],
    now: Date,
  ): BlogRevisionRow[] {
    const since = now.getTime() - REVISION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    return rows
      .filter(
        (row) =>
          row.publishedAt.getTime() >= since &&
          row.publishedAt.getTime() < now.getTime() &&
          hasRevisedLines(row),
      )
      .sort((left, right) => right.count.percent - left.count.percent)
      .slice(0, CONVENTION_SOURCE_LIMIT);
  }

  private buildPrompt(rows: readonly BlogRevisionRow[]): string {
    const source = rows
      .map((row, index) => {
        const changes = row.changes ?? { addedLines: [], removedLines: [] };
        return (
          '편 ' +
          (index + 1) +
          '\n지워진 줄:\n' +
          (changes.removedLines.join('\n') || '(없음)') +
          '\n새로 쓴 줄:\n' +
          (changes.addedLines.join('\n') || '(없음)')
        );
      })
      .join('\n\n');
    return (
      source +
      '\n\n위 반복 패턴을 편집 단계의 실행 규칙으로 일반화하라. JSON {"conventions":["규칙"]}만 반환하라. 최대 ' +
      MAX_CONVENTIONS +
      '개, 각 규칙은 ' +
      MAX_CONVENTION_LENGTH +
      '자 이내 한 줄로 작성하라. 문체·말투는 제외하라.'
    );
  }

  private parseConventions(text: string): string[] {
    let parsed: unknown;
    try {
      // 스키마를 걸어도 최후 방어선은 추출기다 — 스키마는 codex 경로에만 적용되고
      // (claude CLI 미지원, mock provider 는 임의 문자열) 펜스·앞뒤 설명이 섞여 들어온
      // 실패 이력이 이 파이프라인에 있다(blog-publish.schema.ts 의 run#864).
      parsed = JSON.parse(extractJsonObjectText(text)) as unknown;
    } catch {
      throw new Error('규칙 추출 응답 JSON 파싱 실패');
    }
    if (parsed === null || typeof parsed !== 'object') {
      throw new Error('규칙 추출 응답 형태가 객체가 아니다');
    }
    const output = parsed as ConventionModelOutput;
    if (!Array.isArray(output.conventions)) {
      throw new Error('규칙 추출 응답에 conventions 배열이 없다');
    }
    return output.conventions
      .filter(
        (convention): convention is string => typeof convention === 'string',
      )
      .map((convention) => convention.trim())
      .filter(
        (convention) =>
          convention.length > 0 &&
          convention.length <= MAX_CONVENTION_LENGTH &&
          !/\r|\n/u.test(convention) &&
          !mentionsContract(convention),
      )
      .slice(0, MAX_CONVENTIONS);
  }
}
