import { todayInKst } from '../../agent/vacation/domain/plain-date';
import { CollectionWindowInput } from './collection-window.type';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const resolveCollectionLowerBound = ({
  lastSucceededAt,
  now,
}: CollectionWindowInput): Date => {
  if (lastSucceededAt) {
    return new Date(lastSucceededAt.getTime() - TWO_HOURS_MS);
  }
  const today = todayInKst(now);
  return new Date(Date.UTC(today.year, today.month - 1, 1) - KST_OFFSET_MS);
};
