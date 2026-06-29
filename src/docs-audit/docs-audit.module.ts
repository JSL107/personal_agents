import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ModelRouterModule } from '../model-router/model-router.module';
import {
  DocExcerptReader,
  RunDocsAuditUseCase,
} from './application/run-docs-audit.usecase';
import { DOCS_AUDIT_PORT } from './domain/port/docs-audit.port';
import { CodexDocsJudgeAdapter } from './infrastructure/codex-docs-judge.adapter';
import {
  CommandRunner,
  DeterministicDocsChecker,
} from './infrastructure/deterministic-docs.checker';
import {
  DocsRevisionApplier,
  FullDocReader,
} from './infrastructure/docs-revision.applier';
import { GitChangedFilesProvider } from './infrastructure/git-changed-files.provider';

// 모든 자식 프로세스(pnpm/git)를 도는 공유 runner — Checker/Git provider 가 공유(DRY).
const sharedRunner: CommandRunner = (command, args) =>
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

const fileExcerptReader: DocExcerptReader = async (filePath) => {
  try {
    const text = await readFile(join(process.cwd(), filePath), 'utf8');
    return text.slice(0, 8000); // 컨텍스트 가드 — 발췌만.
  } catch {
    return '';
  }
};

const fullDocReader: FullDocReader = async (path) => {
  try {
    return await readFile(join(process.cwd(), path), 'utf8');
  } catch {
    return '';
  }
};

@Module({
  imports: [ModelRouterModule],
  providers: [
    CodexDocsJudgeAdapter,
    {
      provide: DeterministicDocsChecker,
      useValue: new DeterministicDocsChecker(sharedRunner),
    },
    {
      provide: GitChangedFilesProvider,
      useValue: new GitChangedFilesProvider(sharedRunner),
    },
    {
      provide: DocsRevisionApplier,
      useValue: new DocsRevisionApplier(fullDocReader),
    },
    {
      provide: DOCS_AUDIT_PORT,
      useFactory: (
        judge: CodexDocsJudgeAdapter,
        checker: DeterministicDocsChecker,
        gitFiles: GitChangedFilesProvider,
        config: ConfigService,
        revisionApplier: DocsRevisionApplier,
      ) => {
        const maxFiles = Number(config.get('DOCS_AUDIT_MAX_FILES')) || 5;
        const maxIterations =
          Number(config.get('DOCS_AUDIT_MAX_ITERATIONS')) || 3;
        return new RunDocsAuditUseCase(
          checker,
          gitFiles,
          judge,
          fileExcerptReader,
          maxFiles,
          maxIterations,
          revisionApplier,
        );
      },
      inject: [
        CodexDocsJudgeAdapter,
        DeterministicDocsChecker,
        GitChangedFilesProvider,
        ConfigService,
        DocsRevisionApplier,
      ],
    },
  ],
  exports: [DOCS_AUDIT_PORT],
})
export class DocsAuditModule {}
