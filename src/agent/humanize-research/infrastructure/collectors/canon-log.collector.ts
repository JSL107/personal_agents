import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { resolveHumanizeRulesRepoPath } from '../../../../humanize/domain/humanize-rules-repository';
import {
  CollectionResult,
  CollectionStatus,
  HumanizeResearchSource,
  Processed,
} from '../../domain/humanize-research.type';
import { runGit } from './upstream-rule-diff.collector';

const COMMIT_BODY_LIMIT = 500;
const ITEM_TEXT_LIMIT = 8_000;
const GIT_ERROR_PREVIEW = 200;
// git log의 필드·레코드 구분자는 제어 문자로 고정된다.
const COMMIT_HEADER = new RegExp(
  // eslint-disable-next-line no-control-regex
  '([0-9a-f]{40})\\x1f([^\\x1f]*)\\x1f([\\s\\S]*?)\\x1e',
  'gu',
);

interface CanonCommit {
  hash: string;
  subject: string;
  body: string;
  files: string[];
}

@Injectable()
export class CanonLogCollector {
  constructor(private readonly configService: ConfigService) {}

  async collect(processed: Processed): Promise<CollectionResult> {
    try {
      const directory = resolveHumanizeRulesRepoPath(
        this.configService.get<string>('HUMANIZE_RULES_REPO_PATH'),
      );
      const range = await this.range({
        directory,
        canonHead: processed.canonHead,
      });
      const output = await this.checked({
        directory,
        args: [
          'log',
          '--reverse',
          '--format=%H%x1f%s%x1f%b%x1e',
          '--name-only',
          ...range,
        ],
      });
      const commits = this.parseCommits(output);
      if (commits.length === 0) {
        return {
          source: HumanizeResearchSource.CANON_LOG,
          status: CollectionStatus.EMPTY,
          items: [],
        };
      }

      const included: string[] = [];
      for (const commit of commits) {
        const rendered = this.renderCommit(commit);
        const next = [...included, rendered].join('\n\n');
        if (next.length > ITEM_TEXT_LIMIT) {
          if (included.length === 0) {
            included.push(rendered.slice(0, ITEM_TEXT_LIMIT));
          }
          break;
        }
        included.push(rendered);
      }
      const text = included.join('\n\n');
      const lastHash = commits[included.length - 1].hash;
      return {
        source: HumanizeResearchSource.CANON_LOG,
        status: CollectionStatus.OK,
        items: [
          {
            id: `canon:${lastHash}`,
            source: HumanizeResearchSource.CANON_LOG,
            text,
          },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        source: HumanizeResearchSource.CANON_LOG,
        status: CollectionStatus.FAILED,
        items: [],
        error: message,
      };
    }
  }

  private async range({
    directory,
    canonHead,
  }: {
    directory: string;
    canonHead: string | null;
  }): Promise<string[]> {
    if (!canonHead) {
      return ['--since=30.days'];
    }

    const result = await runGit({
      directory,
      args: ['merge-base', '--is-ancestor', canonHead, 'HEAD'],
    });
    if (result.exitCode === 0) {
      return [`${canonHead}..HEAD`];
    }
    return ['--since=30.days'];
  }

  private parseCommits(output: string): CanonCommit[] {
    const headers = Array.from(output.matchAll(COMMIT_HEADER));
    const commits = headers.map((header, index) =>
      this.toCommit({ output, header, next: headers[index + 1] }),
    );
    return commits;
  }

  // 커밋의 변경 파일 목록은 이 헤더 끝부터 다음 헤더 시작(없으면 출력 끝)까지다.
  private toCommit({
    output,
    header,
    next,
  }: {
    output: string;
    header: RegExpExecArray;
    next: RegExpExecArray | undefined;
  }): CanonCommit {
    const end = (header.index ?? 0) + header[0].length;
    const fileText = output.slice(end, next?.index ?? output.length);
    const files = fileText
      .split('\n')
      .map((file) => file.trim())
      .filter(Boolean);
    const commit = {
      hash: header[1],
      subject: header[2],
      body: header[3].trim(),
      files,
    };
    return commit;
  }

  private renderCommit(commit: CanonCommit): string {
    const files = commit.files.join(', ');
    const body = commit.body.slice(0, COMMIT_BODY_LIMIT);
    const lines = [`커밋 ${commit.hash}: ${commit.subject}`];
    if (files) {
      lines.push(`변경 파일: ${files}`);
    }
    if (body) {
      lines.push(`본문: ${body}`);
    }
    return lines.join('\n');
  }

  private async checked({
    directory,
    args,
  }: {
    directory: string;
    args: string[];
  }): Promise<string> {
    const result = await runGit({ directory, args });
    if (result.exitCode !== 0) {
      throw new Error(
        `git ${args[0]} 실패: ${result.stderr.slice(0, GIT_ERROR_PREVIEW)}`,
      );
    }
    return result.stdout;
  }
}
