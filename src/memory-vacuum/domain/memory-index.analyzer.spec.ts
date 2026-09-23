import { diagnoseMemoryIndex } from './memory-index.analyzer';
import { MemoryIndexSnapshot } from './memory-index.type';

const buildSnapshot = (
  indexContent: string,
  fileNames: string[],
  satelliteContent = '',
): MemoryIndexSnapshot => ({
  project: 'test-project',
  indexPath: '/tmp/MEMORY.md',
  indexContent,
  satelliteContent,
  files: fileNames.map((fileName) => ({ fileName, title: fileName })),
});

describe('diagnoseMemoryIndex', () => {
  it('색인에 없는 파일을 고아로 집는다', () => {
    const snapshot = buildSnapshot('- [있음](a.md)\n', ['a.md', 'b.md']);

    const diagnosis = diagnoseMemoryIndex(snapshot);

    expect(diagnosis.dust.orphans).toEqual(['b.md']);
  });

  it('묶음 줄이 대표하는 접두의 파일은 고아가 아니다', () => {
    // 이 판정이 없으면 묶인 파일 전부가 고아로 잡혀 색인을 도로 부풀린다.
    const snapshot = buildSnapshot(
      '- [오피스 화면 19건](project_office_pixel_refit.md) — 40px 고정. `ls project_office_*`\n',
      ['project_office_pixel_refit.md', 'project_office_room_walls.md'],
    );

    const diagnosis = diagnoseMemoryIndex(snapshot);

    expect(diagnosis.dust.orphans).toEqual([]);
  });

  it('위성 색인(TOPICS.md)에 등재된 파일은 고아가 아니다', () => {
    // 이 판정이 없으면 위성에 옮겨 둔 기억 전부가 매 회차 고아로 잡혀 「개별」로
    // 도로 실린다 — 2026-09-20 실측: 50줄 색인이 300줄이 되어 뒤 100줄이 잘렸다.
    const snapshot = buildSnapshot(
      '- [TOPICS](TOPICS.md)\n',
      ['TOPICS.md', 'feedback_pipe_swallows_exit_code.md'],
      '## 셸·환경·프로세스\n- [파이프가 exit code를 삼킨다](feedback_pipe_swallows_exit_code.md)\n',
    );

    const diagnosis = diagnoseMemoryIndex(snapshot);

    expect(diagnosis.dust.orphans).toEqual([]);
  });

  it('위성 색인의 죽은 링크는 깨진 링크에 섞이지 않는다', () => {
    // 깨진 링크는 MEMORY.md 에서 지울 줄의 목록이다. 위성 것까지 합치면 거기 없는
    // 줄을 지우려 들어 액션 수만 거짓으로 남는다.
    const snapshot = buildSnapshot(
      '- [있음](a.md)\n',
      ['a.md'],
      '- [위성이 가리키는 사라진 파일](satellite_gone.md)\n',
    );

    const diagnosis = diagnoseMemoryIndex(snapshot);

    expect(diagnosis.dust.brokenLinks).toEqual([]);
  });

  it('파일이 없는 링크를 깨진 링크로 집는다', () => {
    const snapshot = buildSnapshot('- [사라짐](gone.md)\n', []);

    const diagnosis = diagnoseMemoryIndex(snapshot);

    expect(diagnosis.dust.brokenLinks).toEqual(['gone.md']);
  });

  it('상한 이하면 초과분이 0 이다', () => {
    const diagnosis = diagnoseMemoryIndex(
      buildSnapshot('- [a](a.md)\n', ['a.md']),
    );

    expect(diagnosis.dust.overflowBytes).toBe(0);
  });

  it('한글 색인의 초과분을 바이트로 잰다', () => {
    // 글자 수로 재면 한글 3바이트가 누락돼 초과를 놓친다.
    const longLine = `- [${'가'.repeat(4_000)}](a.md)\n`;

    const diagnosis = diagnoseMemoryIndex(buildSnapshot(longLine, ['a.md']));

    expect(diagnosis.indexBytes).toBeGreaterThan(12_000);
  });

  it('같은 접두 3개 이상만 묶음 후보로 제안한다', () => {
    const snapshot = buildSnapshot('', [
      'feedback_codex_one.md',
      'feedback_codex_two.md',
      'feedback_codex_three.md',
      'feedback_git_only.md',
      'feedback_git_pair.md',
    ]);

    const diagnosis = diagnoseMemoryIndex(snapshot);

    expect(diagnosis.foldCandidates).toEqual([
      { prefix: 'feedback_codex_', count: 3 },
    ]);
  });

  it('이미 묶인 접두는 다시 제안하지 않는다', () => {
    const snapshot = buildSnapshot('- [묶음](a.md) — `ls feedback_codex_*`\n', [
      'feedback_codex_one.md',
      'feedback_codex_two.md',
      'feedback_codex_three.md',
    ]);

    const diagnosis = diagnoseMemoryIndex(snapshot);

    expect(diagnosis.foldCandidates).toEqual([]);
  });
});
