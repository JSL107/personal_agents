import {
  CountOccurrencesParams,
  ReplaceFirstLiteralParams,
} from './text-occurrence.type';

export const countOccurrences = ({
  source,
  text,
}: CountOccurrencesParams): number => {
  if (text.length === 0) {
    return 0;
  }
  return source.split(text).length - 1;
};

// 첫 등장 하나를 글자 그대로 바꾼다. String.replace 에 문자열을 넘기면 `$&`·`$'` 같은 표기를
// 치환 명령으로 해석해, 문서에 그 글자를 넣으려던 편집이 다른 내용으로 들어간다.
export const replaceFirstLiteral = ({
  source,
  text,
  replacement,
}: ReplaceFirstLiteralParams): string => {
  const index = source.indexOf(text);
  if (index === -1) {
    return source;
  }
  const before = source.slice(0, index);
  const after = source.slice(index + text.length);
  return `${before}${replacement}${after}`;
};
