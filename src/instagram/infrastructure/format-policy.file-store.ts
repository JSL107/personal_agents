import { randomUUID } from 'node:crypto';
import { lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  FormatPolicy,
  policyProblem,
  serializePolicy,
} from '../domain/format-policy';
import { DEFAULT_SKILL_REELS_OUT_ROOT } from '../domain/instagram.constants';
import {
  FormatPolicyRead,
  FormatPolicyStorePort,
} from '../domain/port/format-policy-store.port';

@Injectable()
export class FormatPolicyFileStore implements FormatPolicyStorePort {
  constructor(private readonly config: ConfigService) {}

  private get root(): string {
    const configured = this.config.get<string>('SKILL_REELS_OUT_ROOT');
    return configured
      ? configured.replace(/^~(?=\/|$)/, homedir())
      : DEFAULT_SKILL_REELS_OUT_ROOT;
  }

  async read(): Promise<FormatPolicyRead> {
    try {
      const directory = await lstat(this.root);
      if (!directory.isDirectory() || directory.isSymbolicLink()) {
        return { kind: 'no_directory' };
      }
    } catch (error) {
      if (isMissing(error)) {
        return { kind: 'no_directory' };
      }
      throw error;
    }
    const path = join(this.root, 'format-policy.json');
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        return { kind: 'broken', reason: 'symlink 또는 일반 파일이 아님' };
      }
      const raw = await readFile(path, 'utf8');
      const versionTokens = [...raw.matchAll(/"version"\s*:\s*([^,}\s]+)/g)];
      if (versionTokens.length !== 1 || !/^-?\d+$/.test(versionTokens[0][1])) {
        return { kind: 'broken', reason: 'version은 정수 토큰이어야 합니다' };
      }
      const value: unknown = JSON.parse(raw);
      const problem = policyProblem(value);
      if (problem) {
        return { kind: 'broken', reason: problem };
      }
      return { kind: 'ok', policy: value as FormatPolicy };
    } catch (error) {
      if (isMissing(error)) {
        return { kind: 'missing' };
      }
      if (error instanceof SyntaxError) {
        return { kind: 'broken', reason: error.message };
      }
      throw error;
    }
  }

  async write(policy: FormatPolicy): Promise<void> {
    const problem = policyProblem(policy);
    if (problem) {
      throw new Error(`유효하지 않은 정책: ${problem}`);
    }
    const serialized = serializePolicy(policy);
    if (!/^\{"version":-?\d+,/.test(serialized)) {
      throw new Error('정책 version은 정수 토큰이어야 합니다');
    }
    const state = await this.read();
    if (state.kind === 'no_directory' || state.kind === 'broken') {
      throw new Error(`정책을 쓸 수 없습니다: ${state.kind}`);
    }
    const path = join(this.root, 'format-policy.json');
    if (state.kind === 'ok') {
      const backup = join(
        this.root,
        `format-policy.v${state.policy.version}.json`,
      );
      try {
        const stat = await lstat(backup);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          throw new Error('정책 백업 경로가 일반 파일이 아닙니다');
        }
      } catch (error) {
        if (!isMissing(error)) {
          throw error;
        }
      }
      await writeFile(backup, await readFile(path), { flag: 'w' });
    }
    const temporary = join(
      this.root,
      `.format-policy.${process.pid}.${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporary, serialized, { flag: 'wx' });
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch((error: unknown) => {
        if (!isMissing(error)) {
          throw error;
        }
      });
    }
  }
}

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'ENOENT';
