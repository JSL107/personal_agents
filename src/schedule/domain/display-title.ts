import {
  FALLBACK_TITLE_MAX_LENGTH,
  SHORT_TITLE_MAX_LENGTH,
} from './daily-todo.constant';

interface DisplayTitleItem {
  title: string;
  shortTitle: string | null;
  shortTitleBasis: string | null;
}

export const fallbackTitle = (title: string): string => {
  // 수집기 저장소 접두와 태그, conventional commit 접두가 연속될 수 있다.
  const stripped = title
    .trim()
    .replace(
      /^(?:\[[^\]]+\]\s*|(?:[a-z]+(?:\([^)]*\))?|(?:기능 추가|버그 수정|기능 개선|리팩터링|문서 수정|테스트 추가)):\s*)+/i,
      '',
    )
    .trim();
  // 접두만 있는 제목이면 떼고 나서 비므로 원래 제목을 쓴다.
  const result = (stripped || title.trim()).replace(/\s*—\s*/g, ', ').trim();
  if (result.length > FALLBACK_TITLE_MAX_LENGTH) {
    return `${result.slice(0, FALLBACK_TITLE_MAX_LENGTH - 1)}…`;
  }
  return result;
};

export const displayTitle = (item: DisplayTitleItem): string => {
  if (item.shortTitle && item.shortTitleBasis === item.title) {
    return item.shortTitle;
  }
  return fallbackTitle(item.title);
};

export const validateShortTitle = (text: string): boolean =>
  text.trim().length > 0 &&
  text.length <= SHORT_TITLE_MAX_LENGTH &&
  !/[—\r\n]/.test(text) &&
  !/^\s*#\d+\s*$/.test(text);
