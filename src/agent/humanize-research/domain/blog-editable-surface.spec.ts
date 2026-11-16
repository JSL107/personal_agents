import { HUMANIZE_RULE_LINKS } from '../../../humanize/domain/humanize-rule-links';
import {
  BLOG_PROMPT_FILE,
  blogEditableTexts,
  renderBlogEditableSurface,
} from './blog-editable-surface';

it('metrics 파일 링크는 제외하고 현재 연결표 기준 프롬프트 링크 수와 일치한다', () => {
  const texts = blogEditableTexts(HUMANIZE_RULE_LINKS);
  const links = HUMANIZE_RULE_LINKS.filter(
    (link) => link.local.file === BLOG_PROMPT_FILE,
  );
  expect(texts).toEqual(links.map((link) => link.local.text));
  expect(renderBlogEditableSurface(texts)).toContain('블로그 편집 가능 문구:');
});
