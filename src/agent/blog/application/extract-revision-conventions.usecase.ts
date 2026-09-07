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
          row.publishedAt.getTime() < now.getTime(),
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
          !/\r|\n/u.test(convention),
      )
      .slice(0, MAX_CONVENTIONS);
  }
}
