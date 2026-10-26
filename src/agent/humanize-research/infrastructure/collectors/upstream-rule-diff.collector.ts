import { spawn } from 'node:child_process';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { expandHomePath } from '../../../../common/util/expand-home-path.util';
import { DEFAULT_HUMANIZE_RULES_REPO_PATH } from '../../../../humanize/domain/humanize-rules-repository';
import {
  CollectionResult,
  CollectionStatus,
  HumanizeResearchSource,
  Processed,
} from '../../domain/humanize-research.type';
import {
  chooseUpstreamRange,
  composeUpstreamText,
} from '../../domain/upstream-range';

const RULES_PATH = 'skills/humanize-korean/';
const OUTPUT_BUDGET = 20_000;

interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

type GitRunner = (input: {
  directory: string;
  args: string[];
}) => Promise<GitResult>;

const GIT_OUTPUT_LIMIT = 100_000;

// shell 없이 argv를 그대로 넘긴다. 정본 저장소에는 fetch 외의 쓰기 명령을 실행하지 않는다.
// stderr 를 stdout 에 섞으면 rev-parse 해시에 경고문이 붙고, 조각마다 toString 하면
// 한글 커밋 제목이 조각 경계에서 깨진다 — 스트림 단위 utf8 디코딩으로 받는다.
export const runGit: GitRunner = ({ directory, args }) =>
  new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: directory,
      shell: false,
      timeout: 20_000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout = (stdout + chunk).slice(0, GIT_OUTPUT_LIMIT);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(0, GIT_OUTPUT_LIMIT);
    });
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({ exitCode: code ?? 1, stdout, stderr }),
    );
  });

@Injectable()
export class UpstreamRuleDiffCollector {
  constructor(private readonly configService: ConfigService) {}

  async collect(processed: Processed): Promise<CollectionResult> {
    try {
      const configured =
        this.configService.get<string>('HUMANIZE_RULES_REPO_PATH') ??
        DEFAULT_HUMANIZE_RULES_REPO_PATH;
      const directory = expandHomePath(configured);
      await this.checked({ directory, args: ['fetch', 'upstream'] });
      const head = (
        await this.checked({ directory, args: ['rev-parse', 'upstream/main'] })
      ).trim();
      let isAncestor = false;
      if (processed.upstreamHead) {
        const result = await runGit({
          directory,
          args: [
            'merge-base',
            '--is-ancestor',
            processed.upstreamHead,
            'upstream/main',
          ],
        });
        isAncestor = result.exitCode === 0;
      }
      const range = chooseUpstreamRange({
        priorHead: processed.upstreamHead,
        isAncestor,
      });
      const commits = await this.checked({
        directory,
        args: ['log', '--format=%h %s', ...range.args, '--', RULES_PATH],
      });
      if (commits.trim().length === 0) {
        return {
          source: HumanizeResearchSource.UPSTREAM,
          status: CollectionStatus.EMPTY,
          items: [],
        };
      }
      const patch = await this.checked({
        directory,
        args: ['log', '--format=%h %s', '-p', ...range.args, '--', RULES_PATH],
      });
      const text = composeUpstreamText({
        commits,
        patch,
        budget: OUTPUT_BUDGET,
      });
      return {
        source: HumanizeResearchSource.UPSTREAM,
        status: CollectionStatus.OK,
        items: [
          {
            id: `upstream:${head}`,
            source: HumanizeResearchSource.UPSTREAM,
            text,
          },
        ],
      };
    } catch (error: unknown) {
      return {
        source: HumanizeResearchSource.UPSTREAM,
        status: CollectionStatus.FAILED,
        items: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async checked(input: {
    directory: string;
    args: string[];
  }): Promise<string> {
    const result = await runGit(input);
    if (result.exitCode !== 0) {
      throw new Error(
        `git ${input.args[0]} 실패: ${result.stderr.slice(0, 200)}`,
      );
    }
    return result.stdout;
  }
}
