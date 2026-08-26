import { execFile } from 'node:child_process';
import * as fileSystem from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { cwd } from 'node:process';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  SnapshotManifestSummary,
  SnapshotStatus,
} from '../domain/ai-cli-env.type';
import { AiCliEnvPort } from '../domain/port/ai-cli-env.port';

const EXPORT_TIMEOUT_MS = 60_000;
const BOOTSTRAP_TIMEOUT_MS = 600_000;

type SnapshotTool = {
  enabledPlugins?: unknown;
  plugins?: unknown;
  mcpServers?: unknown;
  assets?: unknown;
};

type SnapshotManifest = {
  sourceHome?: unknown;
  sourceHost?: unknown;
  generatedAt?: unknown;
  secretsRequired?: unknown;
  credentialWarnings?: unknown;
  claude?: SnapshotTool | null;
  codex?: SnapshotTool | null;
};

type SecretRequirement = {
  envKey: string;
};

type AppliedSnapshot = {
  sha?: unknown;
};

type CommandResult = {
  stdout: string;
  stderr: string;
};

const BOOTSTRAP_ENV_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'SHELL',
  'TMPDIR',
] as const;
// export 가 만드는 산출물만 스테이징한다. 절차서처럼 사람이 손대는 파일은 건드리지 않는다.
// 목록에서 빠진 산출물은 워킹트리에만 남아 원격에 영영 올라가지 않으므로, export 가 새 파일을
// 만들면 여기도 같이 늘려야 한다 (apply.sh·tools 가 그렇게 추가됐다).
const EXPORT_MANAGED_FILES = [
  'manifest.json',
  'SECRETS-TODO.md',
  'apply.sh',
] as const;
const EXPORT_MANAGED_DIRECTORIES = ['claude', 'codex', 'tools'] as const;
// 변경 감지에서는 manifest.json 을 뺀다. `generatedAt` 이 매 회차 현재 시각으로 다시 찍히므로,
// 넣어 두면 자산이 한 글자도 안 바뀐 날에도 커밋·push 가 일어나고 다른 PC 에는 새 SHA 마다
// 승인 카드가 뜬다. 자산이 실제로 바뀐 회차에는 manifest 도 함께 스테이징된다.
const EXPORT_CHANGE_DETECT_PATHS = [
  'SECRETS-TODO.md',
  'apply.sh',
  'claude',
  'codex',
  'tools',
] as const;

@Injectable()
export class AiCliEnvAdapter implements AiCliEnvPort {
  private readonly logger = new Logger(AiCliEnvAdapter.name);

  constructor(private readonly configService: ConfigService) {}

  isEnabled(): boolean {
    return Boolean(this.readConfiguredValue('AI_CLI_ENV_SYNC_REPO'));
  }

  async ensureRepository(): Promise<void> {
    const repository = this.readConfiguredValue('AI_CLI_ENV_SYNC_REPO');
    if (!repository) {
      return;
    }
    const syncDirectory = this.getSyncDirectory();
    if (await this.hasDirectory(join(syncDirectory, '.git'))) {
      const currentOrigin = (
        await this.executeGit(['remote', 'get-url', 'origin'], syncDirectory)
      ).trim();
      const configuredRepository = this.normalizeGithubRepository(repository);
      if (
        !configuredRepository ||
        this.normalizeGithubRepository(currentOrigin) !== configuredRepository
      ) {
        const displayOrigin = this.redactOriginCredentials(currentOrigin);
        throw new Error(
          `AI CLI 환경 동기화 저장소가 설정과 다릅니다. 설정: ${repository}, 현재 origin: ${displayOrigin}, 디렉터리: ${syncDirectory}. 디렉터리를 확인한 뒤 직접 정리해 주세요.`,
        );
      }
      // 원격이 아직 빈 저장소면 병합할 ref 가 없어 pull 이 실패한다. 첫 스냅샷을 push 하기
      // 전까지 export·apply 가 모두 여기서 막히므로, 원격에 브랜치가 생긴 뒤에만 pull 한다.
      const remoteHeads = await this.executeGit(
        ['ls-remote', '--heads', 'origin'],
        syncDirectory,
      );
      if (remoteHeads.trim()) {
        await this.executeGit(['pull', '--ff-only'], syncDirectory);
      }
      return;
    }
    await this.execute('git', [
      'clone',
      `https://github.com/${repository}.git`,
      syncDirectory,
    ]);
  }

  async exportSnapshot(): Promise<{ changed: boolean; pushed: boolean }> {
    await this.ensureRepository();
    return await this.exportAndPushSnapshot(true);
  }

  private async exportAndPushSnapshot(retryPushFailure: boolean): Promise<{
    changed: boolean;
    pushed: boolean;
  }> {
    const syncDirectory = this.getSyncDirectory();
    await this.execute(
      'node',
      [join(cwd(), 'scripts', 'export-ai-cli-env.cjs'), syncDirectory],
      { timeout: EXPORT_TIMEOUT_MS },
    );
    const manifest = await this.readManifest(
      join(syncDirectory, 'manifest.json'),
    );
    const credentialWarnings = this.readCredentialWarnings(manifest);
    if (credentialWarnings.length > 0) {
      throw new Error(
        `AI CLI 환경 스냅샷에 자격 증명 의심 항목이 있습니다: ${credentialWarnings.join(', ')}`,
      );
    }
    const status = await this.executeGit(
      ['status', '--porcelain', '--', ...EXPORT_CHANGE_DETECT_PATHS],
      syncDirectory,
    );
    if (!status.trim()) {
      // 자산은 그대로고 manifest 의 타임스탬프만 새로 찍힌 회차다. 되돌리지 않으면 워킹트리가
      // dirty 로 남아, 같은 PC 에서 도는 apply 의 clean 검사에 걸려 복원이 막힌다.
      await this.restoreManifest(syncDirectory);
      return { changed: false, pushed: false };
    }
    await this.stageExportChanges(syncDirectory);
    await this.executeGit(
      ['commit', '-m', `chore(env): 스냅샷 갱신 ${new Date().toISOString()}`],
      syncDirectory,
    );
    try {
      await this.executeGit(['push'], syncDirectory);
    } catch (error) {
      if (!retryPushFailure) {
        throw error;
      }
      await this.recoverFromPushConflict();
      return await this.exportAndPushSnapshot(false);
    }
    return { changed: true, pushed: true };
  }

  private async recoverFromPushConflict(): Promise<void> {
    const syncDirectory = this.getSyncDirectory();
    await this.executeGit(['fetch'], syncDirectory);
    const remoteReference = (
      await this.executeGit(
        ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
        syncDirectory,
      )
    ).trim();
    if (!remoteReference) {
      throw new Error(
        'AI CLI 환경 스냅샷 remote 기본 브랜치를 찾을 수 없습니다.',
      );
    }
    // 이 전용 repo의 local commit은 같은 snapshot export 결과뿐이다. Remote 최신 상태로
    // 버린 뒤 다시 export하면 동일 입력을 재생성하므로 사용자 작업을 잃지 않는다.
    await this.executeGit(['reset', '--hard', remoteReference], syncDirectory);
  }

  // 첫 회차라 manifest 가 아직 추적 대상이 아니면 checkout 이 실패한다. 그 경우는 자산도 전부
  // 새로 생겨 이 경로로 오지 않지만, 실패해도 export 결과를 버릴 이유는 없으므로 경고만 남긴다.
  private async restoreManifest(syncDirectory: string): Promise<void> {
    try {
      await this.executeGit(['checkout', '--', 'manifest.json'], syncDirectory);
    } catch (error: unknown) {
      this.logger.warn(
        `manifest 되돌리기 실패 (워킹트리에 남음): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async stageExportChanges(syncDirectory: string): Promise<void> {
    await this.executeGit(
      ['add', '-A', '--', ...EXPORT_MANAGED_FILES],
      syncDirectory,
    );
    for (const directory of EXPORT_MANAGED_DIRECTORIES) {
      const status = await this.executeGit(
        ['status', '--porcelain', '--', directory],
        syncDirectory,
      );
      if (status.trim()) {
        await this.executeGit(['add', '-A', '--', directory], syncDirectory);
      }
    }
  }

  async readStatus(): Promise<SnapshotStatus> {
    const syncDirectory = this.getSyncDirectory();
    const hasRepository = await this.hasDirectory(join(syncDirectory, '.git'));
    if (!hasRepository) {
      return { available: false };
    }
    const manifest = await this.readManifest(
      join(syncDirectory, 'manifest.json'),
    );
    if (!manifest) {
      return { available: false };
    }
    const headSha = await this.readHeadSha(syncDirectory);
    const appliedSha = await this.readAppliedSha();
    return {
      available: true,
      headSha,
      appliedSha,
      summary: this.toManifestSummary(manifest),
    };
  }

  async applySnapshot(expectedSha: string): Promise<{
    appliedSha: string;
    output: string;
    warnings: string[];
  }> {
    const syncDirectory = this.getSyncDirectory();
    const currentSha = await this.readHeadSha(syncDirectory);
    if (!currentSha) {
      throw new Error('AI CLI 환경 스냅샷 HEAD SHA를 찾을 수 없습니다.');
    }
    if (currentSha !== expectedSha) {
      throw new Error(
        `승인한 스냅샷 ${expectedSha.slice(0, 7)}와 현재 HEAD ${currentSha.slice(0, 7)}가 다릅니다. 최신 스냅샷을 다시 승인해 주세요.`,
      );
    }
    const dirtyStatus = await this.executeGit(
      ['status', '--porcelain'],
      syncDirectory,
    );
    if (dirtyStatus.trim()) {
      throw new Error(
        'AI CLI 환경 스냅샷 저장소에 커밋되지 않은 변경이 있어 적용할 수 없습니다.',
      );
    }
    const manifest = await this.readManifest(
      join(syncDirectory, 'manifest.json'),
    );
    const result = await this.executeWithResult(
      'node',
      // --all 을 붙이지 않으면 bootstrap 이 hooks 와 전역 지침 문서를 건너뛴다. 그 기본값은 남의 PC 에
      // 적용하는 상황을 전제한 안전장치인데, 이 동기화는 같은 사람의 PC 사이에서만 도는 기능이라
      // 붙이지 않으면 자동 적용이 끝나도 hooks 가 한 줄도 안 붙어 결국 손으로 채워야 한다.
      // 덮어쓰기 전 기존 파일은 bootstrap 이 타임스탬프를 붙여 백업한다.
      [
        join(cwd(), 'scripts', 'bootstrap-ai-cli-env.cjs'),
        syncDirectory,
        '--all',
      ],
      {
        timeout: BOOTSTRAP_TIMEOUT_MS,
        env: this.buildBootstrapEnvironment(manifest),
      },
    );
    const warnings = this.parseBootstrapWarnings(result.stdout, result.stderr);
    if (warnings.length === 0) {
      await fileSystem.writeFile(
        this.getAppliedSnapshotPath(),
        `${JSON.stringify({ sha: expectedSha, appliedAt: new Date().toISOString() })}\n`,
        'utf8',
      );
    }
    return {
      appliedSha: expectedSha,
      output: result.stdout,
      warnings,
    };
  }

  private readConfiguredValue(key: string): string | undefined {
    const value = this.configService.get<string>(key);
    if (!value) {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private normalizeGithubRepository(value: string): string | undefined {
    const sanitizedValue = this.redactOriginCredentials(value).trim();
    const scpMatch = sanitizedValue.match(/^git@github\.com:(.+)$/i);
    let repositoryPath = scpMatch?.[1];
    if (!repositoryPath && /^[^/:\s]+\/[^/\s]+$/.test(sanitizedValue)) {
      repositoryPath = sanitizedValue;
    }
    if (!repositoryPath) {
      try {
        const url = new URL(sanitizedValue);
        if (
          url.hostname.toLowerCase() !== 'github.com' ||
          !['https:', 'ssh:'].includes(url.protocol)
        ) {
          return undefined;
        }
        repositoryPath = url.pathname;
      } catch {
        return undefined;
      }
    }
    const parts = repositoryPath
      .replace(/^\/+|\/+$/g, '')
      .replace(/\.git$/i, '')
      .split('/');
    if (parts.length !== 2 || parts.some((part) => !part)) {
      return undefined;
    }
    return `${parts[0]}/${parts[1]}`.toLowerCase();
  }

  private redactOriginCredentials(value: string): string {
    try {
      const url = new URL(value.trim());
      if (
        ['http:', 'https:'].includes(url.protocol) &&
        (url.username || url.password)
      ) {
        url.username = '';
        url.password = '';
        return url.toString();
      }
    } catch {
      return value;
    }
    return value;
  }

  private getSyncDirectory(): string {
    const configuredDirectory =
      this.readConfiguredValue('AI_CLI_ENV_SYNC_DIR') ??
      join(homedir(), '.ai-cli-env-sync');
    if (configuredDirectory.startsWith('~/')) {
      return join(homedir(), configuredDirectory.slice(2));
    }
    return configuredDirectory;
  }

  private getAppliedSnapshotPath(): string {
    return join(homedir(), '.ai-cli-env-applied');
  }

  private async hasDirectory(path: string): Promise<boolean> {
    try {
      const stat = await fileSystem.stat(path);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  private async readManifest(path: string): Promise<SnapshotManifest | null> {
    try {
      const content = await fileSystem.readFile(path, 'utf8');
      return JSON.parse(content) as SnapshotManifest;
    } catch {
      return null;
    }
  }

  private async readHeadSha(
    syncDirectory: string,
  ): Promise<string | undefined> {
    try {
      const headSha = await this.executeGit(
        ['rev-parse', 'HEAD'],
        syncDirectory,
      );
      return headSha.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private async readAppliedSha(): Promise<string | undefined> {
    try {
      const content = await fileSystem.readFile(
        this.getAppliedSnapshotPath(),
        'utf8',
      );
      const record = JSON.parse(content) as AppliedSnapshot;
      return typeof record.sha === 'string' ? record.sha : undefined;
    } catch {
      return undefined;
    }
  }

  private toManifestSummary(
    manifest: SnapshotManifest,
  ): SnapshotManifestSummary | undefined {
    if (
      typeof manifest.sourceHome !== 'string' ||
      typeof manifest.generatedAt !== 'string'
    ) {
      return undefined;
    }
    return {
      sourceHome: manifest.sourceHome,
      sourceHost:
        typeof manifest.sourceHost === 'string'
          ? manifest.sourceHost
          : undefined,
      generatedAt: manifest.generatedAt,
      claude: this.toToolSummary(manifest.claude, 'enabledPlugins'),
      codex: this.toToolSummary(manifest.codex, 'plugins'),
    };
  }

  private readCredentialWarnings(manifest: SnapshotManifest | null): string[] {
    if (!manifest || !Array.isArray(manifest.credentialWarnings)) {
      return [];
    }
    return manifest.credentialWarnings.filter(
      (warning): warning is string => typeof warning === 'string',
    );
  }

  private readSecretRequirements(
    manifest: SnapshotManifest | null,
  ): SecretRequirement[] {
    if (!manifest || !Array.isArray(manifest.secretsRequired)) {
      return [];
    }
    return manifest.secretsRequired.filter(
      (requirement): requirement is SecretRequirement =>
        Boolean(
          requirement &&
          typeof requirement === 'object' &&
          'envKey' in requirement &&
          typeof requirement.envKey === 'string',
        ),
    );
  }

  private buildBootstrapEnvironment(
    manifest: SnapshotManifest | null,
  ): NodeJS.ProcessEnv {
    const environment = this.buildBaseEnvironment();
    for (const { envKey } of this.readSecretRequirements(manifest)) {
      const value = this.readConfiguredValue(envKey);
      if (value) {
        environment[envKey] = value;
      }
    }
    return environment;
  }

  // buildSafeChildEnv는 throwaway HOME을 전제로 한 LLM provider 전용이다. 이 스크립트는
  // 사용자 AI CLI 설정을 읽어야 하므로 실제 HOME과 명시적 비민감 allowlist만 전달한다.
  private buildBaseEnvironment(): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = { HOME: homedir() };
    for (const key of BOOTSTRAP_ENV_KEYS) {
      if (key === 'HOME') {
        continue;
      }
      const value = this.readConfiguredValue(key);
      if (value) {
        environment[key] = value;
      }
    }
    return environment;
  }

  private toToolSummary(
    tool: SnapshotTool | null | undefined,
    pluginKey: 'enabledPlugins' | 'plugins',
  ): { plugins: number; mcpServers: number; assets: number } | undefined {
    if (!tool) {
      return undefined;
    }
    const plugins = Array.isArray(tool[pluginKey]) ? tool[pluginKey].length : 0;
    const mcpServers = this.countObjectEntries(tool.mcpServers);
    const assets = this.countAssetEntries(tool.assets);
    return { plugins, mcpServers, assets };
  }

  private countObjectEntries(value: unknown): number {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return 0;
    }
    return Object.keys(value).length;
  }

  private countAssetEntries(value: unknown): number {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return 0;
    }
    return Object.values(value).reduce<number>((count, entries) => {
      return count + (Array.isArray(entries) ? entries.length : 0);
    }, 0);
  }

  private parseBootstrapWarnings(output: string, stderr: string): string[] {
    const lines = output.split(/\r?\n/);
    const resultMarkerIndex = lines.findIndex(
      (line) => line.trim() === '--- 결과 ---',
    );
    const warningHeaderIndex = lines.findIndex(
      (line, index) =>
        index > resultMarkerIndex && /^주의 \d+건:$/.test(line.trim()),
    );
    const outputWarnings: string[] = [];
    if (resultMarkerIndex >= 0 && warningHeaderIndex >= 0) {
      for (const line of lines.slice(warningHeaderIndex + 1)) {
        const warning = line.match(/^\s+-\s+(.+)$/)?.[1];
        if (!warning) {
          break;
        }
        outputWarnings.push(warning);
      }
    }
    const stderrWarnings = stderr
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return [...outputWarnings, ...stderrWarnings];
  }

  private async executeGit(
    argumentsList: string[],
    syncDirectory: string,
  ): Promise<string> {
    return this.execute('git', argumentsList, { cwd: syncDirectory });
  }

  private async execute(
    command: string,
    argumentsList: string[],
    options: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv } = {},
  ): Promise<string> {
    const result = await this.executeWithResult(
      command,
      argumentsList,
      options,
    );
    const stderr = result.stderr.trim();
    if (stderr) {
      this.logger.warn(stderr);
    }
    return result.stdout;
  }

  private async executeWithResult(
    command: string,
    argumentsList: string[],
    options: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv } = {},
  ): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      execFile(
        command,
        argumentsList,
        {
          cwd: options.cwd,
          env: options.env ?? this.buildBaseEnvironment(),
          timeout: options.timeout ?? EXPORT_TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({ stdout, stderr });
        },
      );
    });
  }
}
