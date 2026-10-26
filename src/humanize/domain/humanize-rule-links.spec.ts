import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { countOccurrences } from '../../common/util/text-occurrence.util';
import { HUMANIZE_RULE_LINKS } from './humanize-rule-links';
import { UpstreamSnapshots } from './humanize-rule-links.type';

const snapshots = JSON.parse(
  readFileSync(resolve(__dirname, 'humanize-rule-links.snapshot.json'), 'utf8'),
) as UpstreamSnapshots;

describe('humanize rule links', () => {
  it('keeps unique ids and one exact local occurrence per link', () => {
    const ids = HUMANIZE_RULE_LINKS.map((link) => link.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const link of HUMANIZE_RULE_LINKS) {
      const file = resolve(__dirname, '../../..', link.local.file);
      const source = readFileSync(file, 'utf8');
      expect(countOccurrences({ source, text: link.local.text })).toBe(1);
      if (link.upstream === null) {
        expect(snapshots[link.id]).toBeUndefined();
        expect(link.note.trim()).not.toBe('');
      } else {
        expect(snapshots[link.id]).toBeDefined();
      }
    }
  });

  it('detects a change inside a linked local rule body', () => {
    const link = HUMANIZE_RULE_LINKS.find(
      (candidate) => candidate.id === 'prompt.translationese.double-passive',
    );
    expect(link).toBeDefined();
    if (!link) {
      return;
    }
    const source = readFileSync(
      resolve(__dirname, '../../..', link.local.file),
      'utf8',
    );
    const changedText = link.local.text.replace('이중', '삼중');
    expect(changedText).not.toBe(link.local.text);
    expect(countOccurrences({ source, text: changedText })).toBe(0);
  });
});
