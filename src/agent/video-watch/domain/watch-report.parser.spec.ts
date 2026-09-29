import { join } from 'node:path';

import { parseWatchReport } from './watch-report.parser';

describe('parseWatchReport', () => {
  const outDir = '/tmp/watch-output';
  const sample = `noise before report\n# watch: video report\n- **Title:** Me at the zoo\n- **Duration:** 00:19 (19.0s)\n- **Transcript:** 6 segments (via captions (en, manual, unknown))\n\n## Frames\n- \`${outDir}/frames/frame_0001.jpg\` (t=00:04, reason=uniform)\n- \`/tmp/elsewhere/frame_0002.jpg\` (t=00:05)\n\n## Transcript\n\n_Source: captions._\n\n\x60\x60\x60\nhello\n\x60\x60\x60`;

  it('parses metadata, transcript, source, and only images contained under outDir', () => {
    expect(parseWatchReport(sample, outDir)).toEqual({
      title: 'Me at the zoo',
      durationSec: 19,
      transcript: 'hello',
      transcriptSource: 'captions (en, manual, unknown)',
      frames: [
        { path: join(outDir, 'frames/frame_0001.jpg'), timestampSec: 4 },
      ],
    });
  });

  it('accepts a report with a transcript and no valid frames', () => {
    const markdown = '# watch: video report\n## Transcript\n```\ntext\n```';
    expect(parseWatchReport(markdown, outDir).frames).toEqual([]);
    expect(parseWatchReport(markdown, outDir).transcript).toBe('text');
  });

  it('rejects output without the report header', () => {
    expect(() => parseWatchReport('not a report', outDir)).toThrow(
      'INVALID_WATCH_REPORT',
    );
  });
});
