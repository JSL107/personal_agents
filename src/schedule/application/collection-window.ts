import { todayInKst } from '../../agent/vacation/domain/plain-date';
import { kstStartOfDay } from '../domain/parse-due-date';
import { CollectionWindowInput } from './collection-window.type';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export const resolveCollectionLowerBound = ({
  lastSucceededAt,
  now,
}: CollectionWindowInput): Date => {
  if (lastSucceededAt) {
    return new Date(lastSucceededAt.getTime() - TWO_HOURS_MS);
  }
  const today = todayInKst(now);
  const monthStart = { year: today.year, month: today.month, day: 1 };
  return kstStartOfDay(monthStart);
};
