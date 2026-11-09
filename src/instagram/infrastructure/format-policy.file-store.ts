import { randomUUID } from 'node:crypto';
import { lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  FormatPolicy,
  isFormatPolicy,
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
      if (!isFormatPolicy(value)) {
        return { kind: 'broken', reason: policyProblem(value) };
      }
      return { kind: 'ok', policy: value };
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

  async write({
    policy,
    previous,
  }: {
    policy: FormatPolicy;
    previous: FormatPolicy | null;
  }): Promise<void> {
    const problem = policyProblem(policy);
    if (problem) {
      throw new Error(`유효하지 않은 정책: ${problem}`);
    }
    const serialized = serializePolicy(policy);
    if (!/^\{"version":-?\d+,/.test(serialized)) {
      throw new Error('정책 version은 정수 토큰이어야 합니다');
    }
    const directory = await lstat(this.root);
    if (!directory.isDirectory() || directory.isSymbolicLink()) {
      throw new Error('정책 출력 폴더가 일반 디렉터리가 아닙니다');
    }
    const path = join(this.root, 'format-policy.json');
    await assertRegularFileOrMissing(path);
    if (previous !== null) {
      const backup = join(this.root, `format-policy.v${previous.version}.json`);
      await assertRegularFileOrMissing(backup);
      await writeFile(backup, serializePolicy(previous), { flag: 'w' });
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

// symlink 를 따라가 운영 폴더 밖에 쓰지 않도록, 있으면 일반 파일이어야 한다.
const assertRegularFileOrMissing = async (path: string): Promise<void> => {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`정책 경로가 일반 파일이 아닙니다: ${path}`);
    }
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }
  }
};

const isMissing = (error: unknown): boolean => {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : null;
  return code === 'ENOENT';
};
