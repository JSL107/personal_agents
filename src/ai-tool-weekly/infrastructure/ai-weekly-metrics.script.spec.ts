import { spawnSync } from 'child_process';
import { join } from 'path';

describe('AI 주간 집계 스크립트', () => {
  const script = join(process.cwd(), 'scripts', 'ai-weekly-metrics.py');

  it('--self-check 는 성공 상태와 확인 문구를 출력한다', () => {
    const result = spawnSync('python3', ['-I', '-B', script, '--self-check'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('self-check ok');
  }, 40_000);

  it('잘못된 --since 는 오류 코드만 출력한다', () => {
    const result = spawnSync(
      'python3',
      ['-I', '-B', script, '--since', 'bad', '--until', 'bad'],
      {
        encoding: 'utf8',
        timeout: 30_000,
      },
    );
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/^AIWM_ERROR BAD_ARGS\n?$/);
  });
});
