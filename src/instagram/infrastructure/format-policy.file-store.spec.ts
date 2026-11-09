import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigService } from '@nestjs/config';

import { FormatPolicy } from '../domain/format-policy';
import { FormatPolicyFileStore } from './format-policy.file-store';

const policy: FormatPolicy = {
  version: 1,
  frozen: false,
  champion: { early_card: false },
  experiment: null,
};

describe('FormatPolicyFileStore', () => {
  let root: string;
  let store: FormatPolicyFileStore;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'format-policy-'));
    store = new FormatPolicyFileStore({
      get: () => root,
    } as unknown as ConfigService);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('출력 폴더가 없으면 no_directory를 반환한다', async () => {
    const missing = new FormatPolicyFileStore({
      get: () => join(root, 'absent'),
    } as unknown as ConfigService);
    expect(await missing.read()).toEqual({ kind: 'no_directory' });
    await expect(missing.write({ policy, previous: null })).rejects.toThrow();
  });
  it('파일이 없으면 missing을 반환한다', async () => {
    expect(await store.read()).toEqual({ kind: 'missing' });
  });
  it.each([
    '{',
    '{"version":1,',
    '{"version":1.0,"frozen":false,"champion":{"early_card":false},"experiment":null}',
    '{}',
  ])('잘못된 정책을 거부한다: %s', async (raw) => {
    await writeFile(join(root, 'format-policy.json'), raw);
    expect((await store.read()).kind).toBe('broken');
  });
  it('심볼릭 링크를 거부한다', async () => {
    await writeFile(join(root, 'target'), JSON.stringify(policy));
    await symlink(join(root, 'target'), join(root, 'format-policy.json'));
    expect((await store.read()).kind).toBe('broken');
    await expect(store.write({ policy, previous: null })).rejects.toThrow();
  });
  it('유효하지 않은 새 정책은 저장하지 않는다', async () => {
    await store.write({ policy, previous: null });
    await expect(
      store.write({
        policy: { ...policy, champion: { early_card: 'invalid' } },
        previous: policy,
      }),
    ).rejects.toThrow();
    expect(await store.read()).toEqual({ kind: 'ok', policy });
  });
  it('기존 버전을 보관하고 새 정책을 저장한다', async () => {
    await store.write({ policy, previous: null });
    const next = { ...policy, version: 2 };
    await store.write({ policy: next, previous: policy });
    expect(
      JSON.parse(await readFile(join(root, 'format-policy.v1.json'), 'utf8')),
    ).toEqual(policy);
    expect(await store.read()).toEqual({ kind: 'ok', policy: next });
  });
});
