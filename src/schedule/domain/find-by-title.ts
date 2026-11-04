import { FindByTitleInput, TitleMatch } from './management-intent.type';
import { isUnfinished } from './schedule.type';

export const findByTitle = ({ items, query }: FindByTitleInput): TitleMatch => {
  const text = query.toLocaleLowerCase();
  const matches = items.filter((item) => {
    const title = item.title.trim();
    return (
      title.length >= 2 &&
      isUnfinished(item.status) &&
      text.includes(title.toLocaleLowerCase())
    );
  });
  if (matches.length === 0) {
    return { kind: 'NONE' };
  }
  if (matches.length === 1) {
    return { kind: 'ONE', item: matches[0] };
  }
  return { kind: 'MANY', items: matches };
};
