import { Injectable, Logger } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  CODE_GRAPH_SNAPSHOT_VERSION,
  CodeGraphSnapshot,
} from '../domain/code-graph.type';

// V3 SOTA Foundation 1.1 단계 3 — Code Graph snapshot 의 JSON 직렬화/복원.
// 기본 위치는 caller 가 결정 (var/code-graph-snapshot.json 권장 — .gitignore 처리됨).
// 실패 시 모두 graceful — 부팅 차단 X, caller 가 rebuild fallback 으로 복구.
@Injectable()
export class CodeGraphSnapshotStore {
  private readonly logger = new Logger(CodeGraphSnapshotStore.name);

  async save({
    snapshot,
    path,
  }: {
    snapshot: CodeGraphSnapshot;
    path: string;
  }): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(snapshot, null, 2), 'utf8');
  }

  async load(path: string): Promise<CodeGraphSnapshot | null> {
    try {
      const text = await readFile(path, 'utf8');
      const parsed = JSON.parse(text) as Partial<CodeGraphSnapshot>;
      if (
        typeof parsed.version !== 'number' ||
        parsed.version !== CODE_GRAPH_SNAPSHOT_VERSION
      ) {
        this.logger.warn(
          `Code Graph snapshot version 불일치 — 기대 ${CODE_GRAPH_SNAPSHOT_VERSION}, 실제 ${String(parsed.version)}. rebuild 필요.`,
        );
        return null;
      }
      if (
        typeof parsed.rootDir !== 'string' ||
        !Array.isArray(parsed.chunks) ||
        !Array.isArray(parsed.relations) ||
        typeof parsed.builtAt !== 'string'
      ) {
        this.logger.warn(
          'Code Graph snapshot 형식 손상 — rebuild 필요.',
        );
        return null;
      }
      return parsed as CodeGraphSnapshot;
    } catch (error: unknown) {
      // 파일 없으면 ENOENT — 정상. 그 외에는 warn 후 rebuild fallback.
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== 'ENOENT') {
        this.logger.warn(
          `Code Graph snapshot 로드 실패 (rebuild fallback): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return null;
    }
  }
}
