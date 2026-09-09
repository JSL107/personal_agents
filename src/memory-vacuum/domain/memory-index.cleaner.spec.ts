import { diagnoseMemoryIndex } from './memory-index.analyzer';
import { trimHook, vacuumMemoryIndex } from './memory-index.cleaner';
import { MemoryFile, MemoryIndexSnapshot } from './memory-index.type';

const buildSnapshot = (
  indexContent: string,
  files: MemoryFile[],
): MemoryIndexSnapshot => ({
  project: 'test-project',
  indexPath: '/tmp/MEMORY.md',
  indexContent,
  files,
});

const runVacuum = (indexContent: string, files: MemoryFile[]) => {
  const snapshot = buildSnapshot(indexContent, files);
  return vacuumMemoryIndex(snapshot, diagnoseMemoryIndex(snapshot));
};

describe('trimHook', () => {
  it('첫 문장까지만 남긴다', () => {
    expect(trimHook('핵심이다. 부연은 길다', 60)).toBe('핵심이다');
  });

  it('한글을 바이트 예산에 맞춰 자르되 낱자를 깨뜨리지 않는다', () => {
    const trimmed = trimHook('가'.repeat(40), 12);

    expect(trimmed).toBe('가가가가');
    expect(Buffer.byteLength(trimmed, 'utf8')).toBeLessThanOrEqual(12);
  });

  it('예산이 0 이면 설명을 통째로 뺀다', () => {
    expect(trimHook('무엇이든', 0)).toBe('');
  });
});

describe('vacuumMemoryIndex', () => {
  it('파일 없는 줄을 지운다', () => {
    const outcome = runVacuum('- [사라짐](gone.md)\n- [있음](a.md)\n', [
      { fileName: 'a.md', title: '있음' },
    ]);

    expect(outcome.nextIndexContent).not.toContain('gone.md');
    expect(outcome.actions).toContainEqual({
      type: 'broken_link_removed',
      count: 1,
    });
  });

  it('고아를 개별 섹션 아래에 등록한다', () => {
    const outcome = runVacuum('## 개별\n\n- [있음](a.md)\n', [
      { fileName: 'a.md', title: '있음' },
      { fileName: 'b.md', title: '새 기억' },
    ]);

    expect(outcome.nextIndexContent).toContain('- [새 기억](b.md)');
    expect(outcome.actions).toContainEqual({
      type: 'orphan_indexed',
      count: 1,
    });
  });

  it('개별 섹션이 없으면 끝에 등록한다', () => {
    const outcome = runVacuum('- [있음](a.md)\n', [
      { fileName: 'a.md', title: '있음' },
      { fileName: 'b.md', title: '새 기억' },
    ]);

    expect(outcome.nextIndexContent).toContain('- [새 기억](b.md)');
  });

  it('바꿀 것이 없으면 nextIndexContent 가 null 이다', () => {
    const outcome = runVacuum('- [있음](a.md)', [
      { fileName: 'a.md', title: '있음' },
    ]);

    expect(outcome.nextIndexContent).toBeNull();
    expect(outcome.actions).toEqual([]);
  });

  it('목표를 넘으면 설명을 잘라 목표 밑으로 내린다', () => {
    const files: MemoryFile[] = [];
    const lines: string[] = [];
    for (let index = 0; index < 400; index += 1) {
      const fileName = `feedback_${index}_case.md`;
      files.push({ fileName, title: `교훈 ${index}` });
      lines.push(
        `- [교훈 ${index}](${fileName}) — ${'설명이 길다 '.repeat(8)}`,
      );
    }
    const before = Buffer.byteLength(lines.join('\n'), 'utf8');

    const outcome = runVacuum(lines.join('\n'), files);

    expect(before).toBeGreaterThan(26_000);
    expect(
      Buffer.byteLength(outcome.nextIndexContent ?? '', 'utf8'),
    ).toBeLessThanOrEqual(26_000);
    expect(outcome.remainingOverflowBytes).toBe(0);
  });

  it('묶음 줄의 설명은 자르지 않는다', () => {
    // 묶음 설명은 그 묶음의 목차라, 자르면 안에 무엇이 들어 있는지 알 길이 없어진다.
    const foldLine =
      '- [오피스 화면 19건](project_office_pixel_refit.md) — 40px 고정·방 정원 10석·이름표는 좌석 몫. `ls project_office_*`';
    const filler: MemoryFile[] = [
      { fileName: 'project_office_pixel_refit.md', title: '오피스' },
    ];
    const lines = [foldLine];
    for (let index = 0; index < 400; index += 1) {
      const fileName = `feedback_${index}_case.md`;
      filler.push({ fileName, title: `교훈 ${index}` });
      lines.push(
        `- [교훈 ${index}](${fileName}) — ${'설명이 길다 '.repeat(8)}`,
      );
    }

    const outcome = runVacuum(lines.join('\n'), filler);

    expect(outcome.nextIndexContent).toContain(foldLine);
  });
});
