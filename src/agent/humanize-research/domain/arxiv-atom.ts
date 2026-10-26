export interface ArxivEntry {
  id: string;
  title: string;
  summary: string;
  published: Date;
}

const decodeEntities = (value: string): string =>
  value.replace(
    /&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/giu,
    (match, entity: string) => {
      const named: Record<string, string> = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
      };
      const lowered = entity.toLowerCase();
      if (lowered.startsWith('#x')) {
        return String.fromCodePoint(Number.parseInt(lowered.slice(2), 16));
      }
      if (lowered.startsWith('#')) {
        return String.fromCodePoint(Number.parseInt(lowered.slice(1), 10));
      }
      return named[lowered] ?? match;
    },
  );

const field = (entry: string, name: string): string | null => {
  const match = new RegExp(
    `<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,
    'iu',
  ).exec(entry);
  if (!match) {
    return null;
  }
  const raw = match[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/u, '$1');
  return decodeEntities(raw).replace(/\s+/gu, ' ').trim();
};

/** arXiv Atom 응답에서 연구에 필요한 네 필드만 읽는다. */
export const extractArxivEntries = (xml: string): ArxivEntry[] => {
  const entries = xml.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/giu) ?? [];
  return entries.flatMap((entry) => {
    const id = field(entry, 'id');
    const title = field(entry, 'title');
    const summary = field(entry, 'summary');
    const publishedText = field(entry, 'published');
    if (!id || !title || !summary || !publishedText) {
      return [];
    }
    const published = new Date(publishedText);
    if (Number.isNaN(published.getTime())) {
      return [];
    }
    return [{ id, title, summary, published }];
  });
};
