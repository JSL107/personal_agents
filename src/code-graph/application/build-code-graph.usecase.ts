import { Inject, Injectable, Logger } from '@nestjs/common';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { CodeChunk } from '../domain/code-chunk.type';
import {
  CODE_GRAPH_SNAPSHOT_VERSION,
  CodeGraphSnapshot,
} from '../domain/code-graph.type';
import { CodeRelation } from '../domain/code-relation.type';
import {
  CODE_PARSER_PORT,
  CodeParserPort,
} from '../domain/port/code-parser.port';
import {
  CODE_RELATION_EXTRACTOR_PORT,
  CodeRelationExtractorPort,
} from '../domain/port/code-relation-extractor.port';

// V3 SOTA Foundation 1.1 단계 3 — rootDir 의 .ts 파일을 읽어 chunks + relations snapshot 빌드.
// glob 라이브러리 의존성 없이 fs.readdir({recursive:true}) (Node 20.1+) 사용.
//
// 기본 exclude: spec / node_modules / dist / var. 추후 .gitignore 통합 가능 (단계 4 query 시 fine-tune).
// relative path segment 기반 — absolute path 매칭 시 macOS tmpdir(/var/folders/...) 같은 false positive 회피.
const DEFAULT_EXCLUDE_DIRS = new Set([
  'node_modules',
  'dist',
  'var',
  'coverage',
]);
const DEFAULT_EXCLUDE_SUFFIXES = ['.spec.ts', '.e2e-spec.ts', '.d.ts'];

@Injectable()
export class BuildCodeGraphUsecase {
  private readonly logger = new Logger(BuildCodeGraphUsecase.name);

  constructor(
    @Inject(CODE_PARSER_PORT)
    private readonly parser: CodeParserPort,
    @Inject(CODE_RELATION_EXTRACTOR_PORT)
    private readonly extractor: CodeRelationExtractorPort,
  ) {}

  async execute({ rootDir }: { rootDir: string }): Promise<CodeGraphSnapshot> {
    const files = await this.findTsFiles(rootDir);
    const chunks: CodeChunk[] = [];
    const relations: CodeRelation[] = [];

    for (const absPath of files) {
      const relPath = relative(rootDir, absPath);
      try {
        const source = await readFile(absPath, 'utf8');
        chunks.push(
          ...this.parser.parseFile({ filePath: relPath, source }),
        );
        relations.push(
          ...this.extractor.extractRelations({ filePath: relPath, source }),
        );
      } catch (error: unknown) {
        // 한 파일 파싱 실패가 전체 build 를 끊지 않도록 graceful — 단계 5 BE-3 통합 시 안정성 중요.
        this.logger.warn(
          `Code Graph build — ${relPath} 처리 실패 (skip): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return {
      version: CODE_GRAPH_SNAPSHOT_VERSION,
      rootDir,
      builtAt: new Date().toISOString(),
      chunks,
      relations,
    };
  }

  private async findTsFiles(rootDir: string): Promise<string[]> {
    // codex review P2 — recursive readdir 은 excluded dir 도 모두 descend 후 필터링해
    // node_modules / dist 가 큰 repo 에서 build 시간을 압도. 명시적 재귀 walk 으로 excluded
    // 디렉터리는 처음부터 descend 하지 않는다.
    const files: string[] = [];
    await this.walkDir(rootDir, files);
    return files;
  }

  private async walkDir(dir: string, files: string[]): Promise<void> {
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error: unknown) {
      this.logger.warn(
        `Code Graph build — ${dir} 디렉터리 열기 실패 (skip): ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    for (const entry of entries) {
      const absPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (DEFAULT_EXCLUDE_DIRS.has(entry.name)) {
          continue;
        }
        await this.walkDir(absPath, files);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.ts')) {
        continue;
      }
      if (
        DEFAULT_EXCLUDE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))
      ) {
        continue;
      }
      files.push(absPath);
    }
  }
}
