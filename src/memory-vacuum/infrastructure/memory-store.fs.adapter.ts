import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { MemoryIndexSnapshot } from '../domain/memory-index.type';
import {
  MemoryStoreLoadResult,
  MemoryStorePort,
  MemoryVacuumState,
} from '../domain/port/memory-store.port';

const INDEX_FILE_NAME = 'MEMORY.md';
const MEMORY_DIR_NAME = 'memory';
// 청소 실태 한 장. 프로젝트 루트 옆에 둔다 — 어느 프로젝트에도 속하지 않는 요약이라
// 특정 memory 디렉터리 안에 두면 그 프로젝트의 기억으로 오인돼 청소 대상이 된다.
const STATE_FILE_NAME = '.memory-vacuum-state.json';

// frontmatter description 에서 색인 제목을 뽑는다. 설명은 "무엇 — 부연" 꼴이 많아
// 구분자 앞까지만 쓴다. 사람이 손으로 지은 제목만은 못해도, 고아로 남아 아예
// 보이지 않는 것보다는 낫다(색인에 올라야 다음에 사람이 다듬을 수도 있다).
const TITLE_MAX_LENGTH = 40;

@Injectable()
export class MemoryStoreFsAdapter implements MemoryStorePort {
  private readonly logger = new Logger(MemoryStoreFsAdapter.name);
  private readonly projectsRoot: string;

  constructor(private readonly configService: ConfigService) {
    this.projectsRoot =
      this.configService.get<string>('MEMORY_VACUUM_PROJECTS_ROOT') ??
      join(homedir(), '.claude', 'projects');
  }

  async loadSnapshots(): Promise<MemoryStoreLoadResult> {
    const projects = await this.listProjectDirectories();
    const snapshots: MemoryIndexSnapshot[] = [];
    const unreadable: { project: string; reason: string }[] = [];
    for (const project of projects) {
      try {
        const snapshot = await this.loadSnapshot(project);
        if (snapshot !== null) {
          snapshots.push(snapshot);
        }
      } catch (error) {
        // 한 프로젝트를 못 읽었다고 나머지 청소까지 멈추지는 않는다. 다만 조용히 건너뛰면
        // "이상 없음" 으로 보고되므로 사유를 들고 나가 Slack 에 드러낸다.
        this.logger.warn(
          `[${project}] 색인을 읽지 못해 청소에서 제외합니다: ${String(error)}`,
        );
        unreadable.push({
          project,
          reason: `색인 읽기 실패 — ${String(error)}`,
        });
      }
    }
    return { snapshots, unreadable };
  }

  async backup(snapshot: MemoryIndexSnapshot): Promise<string> {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const backupPath = `${snapshot.indexPath}.bak-${stamp}`;
    try {
      // wx = 이미 있으면 실패. 같은 날 두 번째 청소가 "이미 청소된 색인" 으로 첫 백업을
      // 덮어쓰면 원본을 되돌릴 방법이 사라진다 — 되돌릴 수 없는 쓰기의 유일한 안전장치를
      // 그 쓰기 자신이 지우는 셈이다.
      await fs.writeFile(backupPath, snapshot.indexContent, { flag: 'wx' });
      return backupPath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        this.logger.log(
          `[${snapshot.project}] 오늘 백업이 이미 있어 그대로 둡니다(${backupPath}).`,
        );
        return backupPath;
      }
      throw error;
    }
  }

  async writeIndex(
    snapshot: MemoryIndexSnapshot,
    content: string,
  ): Promise<void> {
    await fs.writeFile(snapshot.indexPath, content, 'utf8');
  }

  async saveState(state: MemoryVacuumState): Promise<void> {
    const path = join(this.projectsRoot, STATE_FILE_NAME);
    await fs.writeFile(path, JSON.stringify(state, null, 2), 'utf8');
  }

  async loadState(): Promise<MemoryVacuumState | null> {
    const raw = await this.readIfExists(
      join(this.projectsRoot, STATE_FILE_NAME),
    );
    if (raw.length === 0) {
      return null;
    }
    try {
      return JSON.parse(raw) as MemoryVacuumState;
    } catch (error) {
      // 깨진 상태 파일은 "청소 안 함" 으로 수렴시킨다 — 화면이 옛 값을 사실처럼 보이는 것보다 낫다.
      this.logger.warn(`청소 실태 파일을 읽지 못했습니다: ${String(error)}`);
      return null;
    }
  }

  private async listProjectDirectories(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.projectsRoot, {
        withFileTypes: true,
      });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch (error) {
      // 루트가 없으면 점검 대상이 없는 것이지 장애가 아니다(CI·컨테이너 환경).
      this.logger.warn(
        `기억 루트를 읽지 못했습니다(${this.projectsRoot}): ${String(error)}`,
      );
      return [];
    }
  }

  private async loadSnapshot(
    project: string,
  ): Promise<MemoryIndexSnapshot | null> {
    const memoryDir = join(this.projectsRoot, project, MEMORY_DIR_NAME);
    let fileNames: string[];
    try {
      fileNames = (await fs.readdir(memoryDir)).filter(
        (name) => name.endsWith('.md') && name !== INDEX_FILE_NAME,
      );
    } catch {
      return null; // memory 디렉터리가 없는 프로젝트 — 점검 대상 아님.
    }
    if (fileNames.length === 0) {
      return null;
    }

    const indexPath = join(memoryDir, INDEX_FILE_NAME);
    const indexContent = await this.readIndex(indexPath);
    const files = [];
    for (const fileName of fileNames.sort()) {
      files.push({
        fileName,
        title: await this.readTitle(join(memoryDir, fileName), fileName),
      });
    }
    return { project, indexPath, indexContent, files };
  }

  // 색인 전용. 파일이 없는 것(ENOENT)만 "아직 색인이 없다" 로 보고, 권한·입출력 오류는
  // 전파한다. 이것을 빈 문자열로 바꾸면 기억 전부가 고아로 판정되어 멀쩡한 색인이
  // 파일 목록으로 덮어씌워진다 — 되돌릴 백업마저 그 빈 내용으로 저장된다.
  private async readIndex(path: string): Promise<string> {
    try {
      return await fs.readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return '';
      }
      throw error;
    }
  }

  private async readIfExists(path: string): Promise<string> {
    try {
      return await fs.readFile(path, 'utf8');
    } catch {
      return '';
    }
  }

  private async readTitle(path: string, fileName: string): Promise<string> {
    const content = await this.readIfExists(path);
    const matched = /^description:\s*(.*)$/m.exec(content);
    if (matched === null) {
      return fileName.replace(/\.md$/, '');
    }
    const description = matched[1].trim().replace(/^["']|["']$/g, '');
    const head = description.split(/\s—\s|\s-\s/)[0].trim();
    return head.length > TITLE_MAX_LENGTH
      ? `${head.slice(0, TITLE_MAX_LENGTH)}…`
      : head;
  }
}
