import { CountOccurrencesParams } from './text-occurrence.type';

export const countOccurrences = ({
  source,
  text,
}: CountOccurrencesParams): number => {
  if (text.length === 0) {
    return 0;
  }
  return source.split(text).length - 1;
};
