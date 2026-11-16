import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { resolveHumanizeRulesRepoPath } from '../../../humanize/domain/humanize-rules-repository';
import {
  HumanizeResearchProposal,
  ProposalSkipReason,
} from '../domain/humanize-research.type';
import {
  CANON_RULES_FILE,
  countMatches,
  findQuickRuleIds,
} from '../domain/proposal-gate';
import { runGit } from './collectors/upstream-rule-diff.collector';

const PYTHON_TIMEOUT_MS = 60_000;
const GOLDEN_DIRECTORY = 'tests/golden/fixtures';

export const CANON_GOLDEN_EXPECTED = [0, 2, 0, 1];

export interface CanonCheckResult {
  reason: ProposalSkipReason | null;
  baseSha: string;
  ruleIds: string[];
}

@Injectable()
export class CanonCheckRunner {
  private readonly logger = new Logger(CanonCheckRunner.name);
  private checkChain: Promise<void> = Promise.resolve();

  constructor(private readonly configService: ConfigService) {}

  async check(proposal: HumanizeResearchProposal): Promise<CanonCheckResult> {
    const result = this.checkChain.then(() => this.checkOnce(proposal));
    this.checkChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async checkOnce(
    proposal: HumanizeResearchProposal,
  ): Promise<CanonCheckResult> {
    const configuredPath = this.configService.get<string>(
      'HUMANIZE_RULES_REPO_PATH',
    );
    const directory = resolveHumanizeRulesRepoPath(configuredPath);
    await this.checkedGit({ directory, args: ['fetch', 'origin'] });
    const baseShaOutput = await this.checkedGit({
      directory,
      args: ['rev-parse', 'origin/main'],
    });
    const baseSha = baseShaOutput.trim();
    const temporaryRoot = tmpdir();
    const temporaryPrefix = join(temporaryRoot, 'humanize-canon-');
    const worktreeDirectory = await mkdtemp(temporaryPrefix);

    const path = this.configService.get<string>('PATH') || '/usr/bin:/bin';
    const env = { PATH: path, PYTHONUTF8: '1', HOME: worktreeDirectory };

    try {
      await this.checkedGit({
        directory,
        args: ['worktree', 'add', '--detach', worktreeDirectory, baseSha],
      });
      const quickRulesPath = join(worktreeDirectory, CANON_RULES_FILE);
      const quickRules = await readFile(quickRulesPath, 'utf8');
      const ruleIds = findQuickRuleIds({
        quickRules,
        oldString: proposal.oldString,
      });
      const matchCount = countMatches({
        text: quickRules,
        search: proposal.oldString,
      });
      if (matchCount !== 1) {
        return {
          reason: ProposalSkipReason.MATCH_NOT_UNIQUE,
          baseSha,
          ruleIds: [],
        };
      }
      const updatedQuickRules = quickRules.replace(
        proposal.oldString,
        () => proposal.newString,
      );
      await writeFile(quickRulesPath, updatedQuickRules, 'utf8');

      const selfcheckCode = await runPython({
        directory: worktreeDirectory,
        env,
        args: ['references/metrics_v2.py', '--selfcheck'],
      });
      if (selfcheckCode !== 0) {
        return {
          reason: ProposalSkipReason.SELFCHECK_FAILED,
          baseSha,
          ruleIds: [],
        };
      }

      const severityCode = await runPython({
        directory: worktreeDirectory,
        env,
        args: ['scripts/check_severity_sync.py'],
      });
      if (severityCode !== 0) {
        return {
          reason: ProposalSkipReason.SEVERITY_SYNC_FAILED,
          baseSha,
          ruleIds: [],
        };
      }

      const goldenCodes = await this.checkGolden({
        directory: worktreeDirectory,
        env,
      });
      const expected = CANON_GOLDEN_EXPECTED.join(',');
      const actual = goldenCodes.join(',');
      if (actual !== expected) {
        return {
          reason: ProposalSkipReason.GOLDEN_FAILED,
          baseSha,
          ruleIds: [],
        };
      }
      return { reason: null, baseSha, ruleIds };
    } finally {
      await this.removeWorktree({ directory, worktreeDirectory });
    }
  }

  private async checkGolden({
    directory,
    env,
  }: {
    directory: string;
    env: NodeJS.ProcessEnv;
  }): Promise<number[]> {
    const fixturesPath = join(directory, GOLDEN_DIRECTORY);
    const entries = await readdir(fixturesPath, { withFileTypes: true });
    const fixtures = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const codes: number[] = [];
    for (const fixture of fixtures) {
      const fixturePath = join(GOLDEN_DIRECTORY, fixture);
      const beforePath = join(fixturePath, 'input.txt');
      for (const outcome of ['good', 'bad']) {
        const afterPath = join(fixturePath, `${outcome}_output.txt`);
        const code = await runPython({
          directory,
          env,
          args: [
            'scripts/verify_gates.py',
            '--before',
            beforePath,
            '--after',
            afterPath,
            '--genre',
            'essay',
          ],
        });
        codes.push(code);
      }
    }
    return codes;
  }

  private async checkedGit({
    directory,
    args,
  }: {
    directory: string;
    args: string[];
  }): Promise<string> {
    const result = await runGit({ directory, args });
    if (result.exitCode !== 0) {
      throw new Error(`git ${args[0]} 실패: ${result.stderr}`);
    }
    return result.stdout;
  }

  private async removeWorktree({
    directory,
    worktreeDirectory,
  }: {
    directory: string;
    worktreeDirectory: string;
  }): Promise<void> {
    try {
      await this.checkedGit({
        directory,
        args: ['worktree', 'remove', '--force', worktreeDirectory],
      });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`정본 임시 worktree 제거 실패: ${detail}`);
      await rm(worktreeDirectory, { recursive: true, force: true });
      try {
        await this.checkedGit({ directory, args: ['worktree', 'prune'] });
      } catch (pruneError: unknown) {
        const pruneDetail =
          pruneError instanceof Error ? pruneError.message : String(pruneError);
        this.logger.warn(`정본 worktree 등록 정리 실패: ${pruneDetail}`);
      }
    }
  }
}

const runPython = ({
  directory,
  args,
  env,
}: {
  directory: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}): Promise<number> => {
  const result = new Promise<number>((resolve, reject) => {
    const child = spawn('python3', args, {
      cwd: directory,
      env,
      shell: false,
      stdio: 'ignore',
      timeout: PYTHON_TIMEOUT_MS,
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === null) {
        reject(new Error(`python3 실행 실패: ${signal ?? '종료 코드 없음'}`));
        return;
      }
      resolve(code);
    });
  });
  return result;
};
