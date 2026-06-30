import { Injectable } from '@nestjs/common';

import {
  DocEdit,
  DocsRevision,
  DocsRevisionProposal,
} from '../domain/port/docs-audit.port';

// 전체 문서 content 로더 — 모듈에서 fs.readFile 래퍼 주입. (DocsRevision 은 port 에 정의됨 — Task 1.)
export type FullDocReader = (path: string) => Promise<string>;

// 순수 — confirmed 제안의 edits 를 대상 문서에 정확·유일 매칭으로 적용해 전체 새 content 산출.
// octokit 무관(테스트 용이). 매칭 0/다중 edit 은 skip(부작용 회피). 적용 0건이면 null.
@Injectable()
export class DocsRevisionApplier {
  constructor(private readonly readDoc: FullDocReader) {}

  async buildRevision(
    confirmed: DocsRevisionProposal[],
  ): Promise<DocsRevision | null> {
    const editsByDoc = new Map<string, DocEdit[]>();
    for (const proposal of confirmed) {
      const bucket = editsByDoc.get(proposal.filePath);
      if (bucket) {
        bucket.push(...proposal.edits);
      } else {
        editsByDoc.set(proposal.filePath, [...proposal.edits]);
      }
    }

    const files: { path: string; content: string }[] = [];
    const previewLines: string[] = [];
    for (const [path, edits] of editsByDoc) {
      const original = await this.readDoc(path);
      let content = original;
      const applied: DocEdit[] = [];
      for (const edit of edits) {
        const occurrences = content.split(edit.oldString).length - 1;
        if (occurrences !== 1) {
          continue; // 매칭 0/다중 — 안전상 skip
        }
        content = content.replace(edit.oldString, edit.newString);
        applied.push(edit);
      }
      if (content === original || applied.length === 0) {
        continue;
      }
      files.push({ path, content });
      previewLines.push(`*${path}* — ${applied.length}개 편집`);
      for (const edit of applied) {
        previewLines.push(
          `> \`${truncate(edit.oldString)}\` → \`${truncate(edit.newString)}\``,
        );
      }
    }

    if (files.length === 0) {
      return null;
    }
    return {
      files,
      changedFiles: files.map((file) => file.path),
      previewText: previewLines.join('\n'),
    };
  }
}

const PREVIEW_SNIPPET_CAP = 120;
function truncate(text: string): string {
  const oneLine = text.replace(/\n/gu, '↵');
  return oneLine.length > PREVIEW_SNIPPET_CAP
    ? `${oneLine.slice(0, PREVIEW_SNIPPET_CAP)}…`
    : oneLine;
}
