import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { Injectable, Logger } from '@nestjs/common';

import { AGENT_REGISTRY } from '../../agent-registry/agent-registry';
import {
  RepoContextPort,
  RepoModuleSummary,
} from '../domain/port/repo-context.port';

const MAX_MODULE_COUNT = 100;

@Injectable()
export class RepoContextCollector implements RepoContextPort {
  private readonly logger = new Logger(RepoContextCollector.name);

  async collect(): Promise<RepoModuleSummary[]> {
    try {
      const sourcePath = join(process.cwd(), 'src');
      const entries = await readdir(sourcePath, { withFileTypes: true });
      const topLevelNames = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
      const agentModuleNames = topLevelNames.includes('agent')
        ? await this.readAgentModuleNames(join(sourcePath, 'agent'))
        : [];
      const moduleNames = [
        ...topLevelNames.filter((name) => name !== 'agent'),
        ...agentModuleNames,
      ];
      return moduleNames
        .sort()
        .slice(0, MAX_MODULE_COUNT)
        .map((name) => ({
          name,
          description: this.findDescription(name),
        }));
    } catch (error) {
      this.logger.warn(
        `레포 모듈 수집 실패 — 빈 목록으로 진행: ${formatError(error)}`,
      );
      return [];
    }
  }

  private async readAgentModuleNames(path: string): Promise<string[]> {
    const entries = await readdir(path, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => `agent/${entry.name}`);
  }

  private findDescription(moduleName: string): string {
    const found = AGENT_REGISTRY.find(
      (entry) => toModuleName(entry.usecasePath) === moduleName,
    );
    return found?.description ?? '';
  }
}

const toModuleName = (usecasePath: string): string => {
  const parts = usecasePath.replace(/^src\//, '').split('/');
  if (parts[0] === 'agent' && parts[1]) {
    return `agent/${parts[1]}`;
  }
  return parts[0] ?? '';
};

const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
