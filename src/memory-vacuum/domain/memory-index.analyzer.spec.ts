import { diagnoseMemoryIndex } from './memory-index.analyzer';
import { MemoryIndexSnapshot } from './memory-index.type';

const buildSnapshot = (
  indexContent: string,
  fileNames: string[],
): MemoryIndexSnapshot => ({
  project: 'test-project',
  indexPath: '/tmp/MEMORY.md',
  indexContent,
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
