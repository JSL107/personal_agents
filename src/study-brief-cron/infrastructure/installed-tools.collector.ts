import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Injectable } from '@nestjs/common';

import { getRealHomeDir } from '../../model-router/infrastructure/cli-process.util';
import { InstalledToolsPort } from '../domain/port/installed-tools.port';

const MAX_TOOL_COUNT = 200;

@Injectable()
export class InstalledToolsCollector implements InstalledToolsPort {
  async collect(): Promise<string[]> {
    const homeDir = getRealHomeDir();
    const directoryGroups = await Promise.all([
      this.readDirectoryNames(join(homeDir, '.claude/skills')),
      this.readDirectoryNames(join(homeDir, '.claude/plugins/cache')),
      this.readDirectoryNames(join(homeDir, '.hermes/skills')),
    ]);
    const mcpNames = await this.readMcpServerNames(
      join(homeDir, '.claude.json'),
    );
    const names = [...directoryGroups.flat(), ...mcpNames];
    return [...new Set(names)].sort().slice(0, MAX_TOOL_COUNT);
  }

  private async readDirectoryNames(path: string): Promise<string[]> {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  private async readMcpServerNames(path: string): Promise<string[]> {
    try {
      const raw = await readFile(path, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return [];
      }
      const mcpServers = (parsed as Record<string, unknown>).mcpServers;
      if (
        typeof mcpServers !== 'object' ||
        mcpServers === null ||
        Array.isArray(mcpServers)
      ) {
        return [];
      }
      return Object.keys(mcpServers);
    } catch {
      return [];
    }
  }
}
