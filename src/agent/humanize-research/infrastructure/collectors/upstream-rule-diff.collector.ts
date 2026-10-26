import { spawn } from 'node:child_process';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { resolveHumanizeRulesRepoPath } from '../../../../humanize/domain/humanize-rules-repository';
import {
  CollectionResult,
  CollectionStatus,
  GitResult,
  HumanizeResearchSource,
  Processed,
  UpstreamCommit,
} from '../../domain/humanize-research.type';
import {
  chooseUpstreamRange,
  selectUpstreamCommits,
} from '../../domain/upstream-range';

const RULES_PATH = 'skills/humanize-korean/';
const OUTPUT_BUDGET = 20_000;
const GIT_TIMEOUT_MS = 20_000;
const GIT_OUTPUT_LIMIT = 100_000;
const GIT_ERROR_PREVIEW = 200;

// shell 없이 argv를 그대로 넘긴다. 정본 저장소에는 fetch 외의 쓰기 명령을 실행하지 않는다.
// stderr 를 stdout 에 섞으면 커밋 목록에 경고문이 끼고, 조각마다 toString 하면
// 한글 커밋 제목이 조각 경계에서 깨진다 — 스트림 단위 utf8 디코딩으로 받는다.
export const runGit = ({
  directory,
  args,
}: {
  directory: string;
  args: string[];
}): Promise<GitResult> =>
  new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: directory,
      shell: false,
      timeout: GIT_TIMEOUT_MS,
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => stdout.push(chunk));
    child.stderr.on('data', (chunk: string) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({
        exitCode: code ?? 1,
        stdout: stdout.join('').slice(0, GIT_OUTPUT_LIMIT),
        stderr: stderr.join('').slice(0, GIT_OUTPUT_LIMIT),
      }),
    );
  });

@Injectable()
export class UpstreamRuleDiffCollector {
  constructor(private readonly configService: ConfigService) {}

  async collect(processed: Processed): Promise<CollectionResult> {
    try {
      const directory = resolveHumanizeRulesRepoPath(
        this.configService.get<string>('HUMANIZE_RULES_REPO_PATH'),
      );
      await this.checked({ directory, args: ['fetch', 'upstream'] });
      const isAncestor = await this.isAncestor({
        directory,
        priorHead: processed.upstreamHead,
      });
      const range = chooseUpstreamRange({
        priorHead: processed.upstreamHead,
        isAncestor,
      });
      const commits = await this.listCommits({ directory, range: range.args });
      const selection = selectUpstreamCommits({
        commits,
        budget: OUTPUT_BUDGET,
      });
      if (!selection) {
        return {
          source: HumanizeResearchSource.UPSTREAM,
          status: CollectionStatus.EMPTY,
          items: [],
        };
      }
      // id 는 upstream/main 끝이 아니라 마지막으로 실은 커밋이다. 처리 기록이 이 값까지만
      // 전진해야 예산 때문에 못 실은 커밋을 다음 회차가 본다.
      return {
        source: HumanizeResearchSource.UPSTREAM,
        status: CollectionStatus.OK,
        items: [
          {
            id: `upstream:${selection.lastHash}`,
            source: HumanizeResearchSource.UPSTREAM,
            text: selection.text,
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

  // 공통 조상이 없는 저장소라 merge-base 로 범위를 잡지 않는다. 직전 회차가 본 해시가
  // 지금 upstream/main 의 조상일 때만 그 뒤를 이어 본다.
  private async isAncestor({
    directory,
    priorHead,
  }: {
    directory: string;
    priorHead: string | null;
  }): Promise<boolean> {
    if (!priorHead) {
      return false;
    }
    const result = await runGit({
      directory,
      args: ['merge-base', '--is-ancestor', priorHead, 'upstream/main'],
    });
    const ancestor = result.exitCode === 0;
    return ancestor;
  }

  private async listCommits({
    directory,
    range,
  }: {
    directory: string;
    range: string[];
  }): Promise<UpstreamCommit[]> {
    const log = await this.checked({
      directory,
      args: [
        'log',
        '--reverse',
        '--format=%H%x09%s',
        ...range,
        '--',
        RULES_PATH,
      ],
    });
    const headers = log
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => {
        const [hash, ...subject] = line.split('\t');
        return { hash, subject: subject.join('\t') };
      });
    return await Promise.all(
      headers.map(async ({ hash, subject }) => {
        const patch = await this.checked({
          directory,
          args: ['show', '--format=', hash, '--', RULES_PATH],
        });
        return { hash, subject, patch };
      }),
    );
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
