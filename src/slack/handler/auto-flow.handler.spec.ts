import * as path from 'node:path';

import { fileExistsRelativeToCwd } from './auto-flow.handler';

// BE_TEST 분배 시 CTO 가 추론한 path 의 실제 존재 검증. LLM hallucination 차단.
describe('fileExistsRelativeToCwd', () => {
  it('repo 에 실제 존재하는 파일 (package.json) 은 true', async () => {
    await expect(fileExistsRelativeToCwd('package.json')).resolves.toBe(true);
  });

  it('repo 안 하위 경로 (자기 자신 파일) 도 true', async () => {
    const selfPath = path.relative(
      process.cwd(),
      path.join(
        process.cwd(),
        'src/slack/handler/auto-flow.handler.spec.ts',
      ),
    );
    await expect(fileExistsRelativeToCwd(selfPath)).resolves.toBe(true);
  });

  it('repo 에 없는 path 는 false (hallucination 케이스)', async () => {
    await expect(
      fileExistsRelativeToCwd('src/does/not/exist.service.ts'),
    ).resolves.toBe(false);
  });

  it('빈 문자열은 false', async () => {
    await expect(fileExistsRelativeToCwd('')).resolves.toBe(false);
  });

  it('absolute path 는 무조건 false (cwd 밖 접근 차단)', async () => {
    // /etc/passwd 는 macOS/linux 에 존재 가능 — 그래도 absolute 라 차단.
    await expect(fileExistsRelativeToCwd('/etc/passwd')).resolves.toBe(false);
    await expect(fileExistsRelativeToCwd('/tmp')).resolves.toBe(false);
  });

  it('path traversal (../) 로 cwd 벗어나면 false', async () => {
    // resolve 후 cwd prefix 검사로 차단. ../ 깊이가 충분히 깊으면 (/ 까지) cwd 밖.
    await expect(
      fileExistsRelativeToCwd('../../../../../etc/passwd'),
    ).resolves.toBe(false);
  });
});
