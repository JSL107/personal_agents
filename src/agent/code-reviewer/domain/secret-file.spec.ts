import { isSecretFilePath } from './secret-file';

describe('isSecretFilePath', () => {
  it.each([
    '.env',
    'apps/api/.env',
    '.env.local',
    'config/.env.production',
    'certs/server.pem',
    'a.key',
    'b.p12',
    'c.pfx',
    'release.keystore',
    'd.jks',
    '.ssh/id_rsa',
    'id_rsa.pub',
    'id_ed25519',
    '.npmrc',
    'pkg/.pypirc',
    '.netrc',
  ])('%s 는 비밀 파일이다', (path) => {
    expect(isSecretFilePath(path)).toBe(true);
  });

  it.each([
    '.env.example',
    'apps/.env.sample',
    '.env.template',
    'src/env.ts',
    'docs/keys.md',
    'monkey.ts',
    'environment.prod.ts',
    'README.md',
  ])('%s 는 비밀 파일이 아니다', (path) => {
    expect(isSecretFilePath(path)).toBe(false);
  });
});
