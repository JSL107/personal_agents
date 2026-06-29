import { spawn } from 'node:child_process';

import { Injectable } from '@nestjs/common';

import { DeterministicDriftReport } from '../domain/port/docs-audit.port';

interface CommandResult {
  exitCode: number;
  output: string;
}

// 주입 가능한 명령 실행기 — 테스트에서 mock.
export type CommandRunner = (
  command: string,
  args: string[],
) => Promise<CommandResult>;

const DEFAULT_RUNNER: CommandRunner = (command, args) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { cwd: process.cwd() });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    child.on('close', (code) => {
      resolve({ exitCode: code ?? 1, output });
    });
  });

const CHECKS: ReadonlyArray<{ label: string; args: string[] }> = [
  { label: 'docs:check', args: ['docs:check'] },
  { label: 'check:env', args: ['check:env'] },
];

@Injectable()
export class DeterministicDocsChecker {
  constructor(private readonly runner: CommandRunner = DEFAULT_RUNNER) {}

  async check(): Promise<DeterministicDriftReport> {
    const details: string[] = [];
    for (const { label, args } of CHECKS) {
      const result = await this.runner('pnpm', args);
      if (result.exitCode !== 0) {
        details.push(`${label} FAIL — ${result.output.slice(0, 300).trim()}`);
      }
    }
    return { inSync: details.length === 0, details };
  }
}
