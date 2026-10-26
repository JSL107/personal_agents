import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { HUMANIZE_RULE_LINKS } from './humanize-rule-links';
import { findLocalTextOccurrences } from './humanize-rule-links.check';

describe('humanize rule links', () => {
  it('keeps unique ids and one exact local occurrence per link', () => {
    const ids = HUMANIZE_RULE_LINKS.map((link) => link.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const link of HUMANIZE_RULE_LINKS) {
      const file = resolve(__dirname, '../../..', link.local.file);
      const source = readFileSync(file, 'utf8');
      expect(findLocalTextOccurrences(source, link.local.text)).toBe(1);
      if (link.upstream === null) {
        expect(link.upstreamSnapshot).toBeNull();
        expect(link.note.trim()).not.toBe('');
      } else {
        expect(link.upstreamSnapshot).not.toBeNull();
      }
    }
  });
});
