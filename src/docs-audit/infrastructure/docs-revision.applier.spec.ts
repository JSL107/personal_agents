import { DocsRevisionApplier } from './docs-revision.applier';

const reader = (docs: Record<string, string>) => (p: string) =>
  Promise.resolve(docs[p] ?? '');

it('정확·유일 매칭 치환 → files+changedFiles+previewText', async () => {
  const applier = new DocsRevisionApplier(
    reader({ 'README.md': 'hello OLD world' }),
  );
  const rev = await applier.buildRevision([
    {
      filePath: 'README.md',
      edits: [{ oldString: 'OLD', newString: 'NEW' }],
      rationale: 'r',
      score: 95,
      confirmed: true,
    },
  ]);
  expect(rev!.files).toEqual([
    { path: 'README.md', content: 'hello NEW world' },
  ]);
  expect(rev!.changedFiles).toEqual(['README.md']);
  expect(rev!.previewText).toContain('README.md');
});

it('다중매칭 edit 은 skip — 적용 0건이면 null', async () => {
  const applier = new DocsRevisionApplier(reader({ 'README.md': 'x x' }));
  const rev = await applier.buildRevision([
    {
      filePath: 'README.md',
      edits: [{ oldString: 'x', newString: 'y' }],
      rationale: 'r',
      score: 95,
      confirmed: true,
    },
  ]);
  expect(rev).toBeNull();
});

it('매칭0 edit 은 skip, 같은 파일 다른 edit 은 적용', async () => {
  const applier = new DocsRevisionApplier(
    reader({ 'README.md': 'keep AAA tail' }),
  );
  const rev = await applier.buildRevision([
    {
      filePath: 'README.md',
      edits: [
        { oldString: 'ZZZ', newString: 'q' },
        { oldString: 'AAA', newString: 'BBB' },
      ],
      rationale: 'r',
      score: 95,
      confirmed: true,
    },
  ]);
  expect(rev!.files[0].content).toBe('keep BBB tail');
});
