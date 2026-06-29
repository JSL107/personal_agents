import { GitChangedFilesProvider } from './git-changed-files.provider';

describe('GitChangedFilesProvider', () => {
  it('SoT 화이트리스트에 든 변경 파일만, maxFiles 까지 반환', async () => {
    const runner = jest.fn().mockResolvedValue({
      exitCode: 0,
      output: [
        'src/agent-registry/agent-registry.ts',
        'src/config/app.config.ts',
        'src/some/unrelated.ts',
        'README.md',
      ].join('\n'),
    });
    const provider = new GitChangedFilesProvider(runner);
    const files = await provider.recentlyChangedSotFiles(5);
    expect(files).toContain('src/agent-registry/agent-registry.ts');
    expect(files).toContain('src/config/app.config.ts');
    expect(files).not.toContain('src/some/unrelated.ts');
  });
});
