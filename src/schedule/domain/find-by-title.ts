import { FindByTitleInput, TitleMatch } from './management-intent.type';
import { isUnfinished, ScheduleItemRecord } from './schedule.type';

const isMentionedUnfinished = ({
  item,
  text,
}: {
  item: ScheduleItemRecord;
  text: string;
}): boolean => {
  const title = item.title.trim();
  const hasEnoughCharacters = title.length >= 2;
  const unfinished = isUnfinished(item.status);
  const mentioned = text.includes(title.toLocaleLowerCase());
  const matches = hasEnoughCharacters && unfinished && mentioned;
  return matches;
};

export const findByTitle = ({ items, query }: FindByTitleInput): TitleMatch => {
  const text = query.toLocaleLowerCase();
  const matches = items.filter((item) => isMentionedUnfinished({ item, text }));
  if (matches.length === 0) {
    return { kind: 'NONE' };
  }
  if (matches.length === 1) {
    return { kind: 'ONE', item: matches[0] };
  }
  return { kind: 'MANY', items: matches };
};
