import { extractArxivEntries } from './arxiv-atom';

// arXiv API User's Manual §4.1 실제 응답의 entry를 네 필드로 축약했다.
const ARXIV_ENTRY_FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
    <id xmlns="http://www.w3.org/2005/Atom">http://arxiv.org/abs/hep-ex/0307015</id>
    <title xmlns="http://www.w3.org/2005/Atom">Multi-Electron Production at High
      Transverse Momenta in ep Collisions at HERA</title>
    <summary xmlns="http://www.w3.org/2005/Atom">Multi-electron production is studied at high electron transverse momentum
      in positron- and electron-proton collisions using the H1 detector at HERA.</summary>
    <published xmlns="http://www.w3.org/2005/Atom">2007-02-27T16:02:02-05:00</published>
  </entry>
</feed>`;

describe('extractArxivEntries', () => {
  it('실제 Atom entry의 ID, 다중 행 제목, 초록과 날짜를 추출한다', () => {
    expect(extractArxivEntries(ARXIV_ENTRY_FIXTURE)).toEqual([
      {
        id: 'http://arxiv.org/abs/hep-ex/0307015',
        title:
          'Multi-Electron Production at High Transverse Momenta in ep Collisions at HERA',
        summary:
          'Multi-electron production is studied at high electron transverse momentum in positron- and electron-proton collisions using the H1 detector at HERA.',
        published: new Date('2007-02-27T16:02:02-05:00'),
      },
    ]);
  });

  it('XML 엔티티를 디코딩한다', () => {
    const xml = ARXIV_ENTRY_FIXTURE.replace('High\n', 'High &amp;\n');
    expect(extractArxivEntries(xml)[0].title).toContain('High & Transverse');
  });
});
