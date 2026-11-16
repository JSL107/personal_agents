import { HUMANIZE_RULE_LINKS } from '../../../humanize/domain/humanize-rule-links';
import { HumanizeRuleLink } from '../../../humanize/domain/humanize-rule-links.type';

export const BLOG_PROMPT_FILE = 'src/humanize/domain/humanize-system.prompt.ts';

export const blogEditableTexts = (
  links: readonly HumanizeRuleLink[],
): string[] => {
  const texts = links
    .filter((link) => link.local.file === BLOG_PROMPT_FILE)
    .map((link) => link.local.text);
  return texts;
};

export const renderBlogEditableSurface = (texts: string[]): string => {
  const lines = texts.map((text) => {
    const link = HUMANIZE_RULE_LINKS.find(
      (item) =>
        item.local.file === BLOG_PROMPT_FILE && item.local.text === text,
    );
    return `- [${link?.id ?? ''}] ${text}`;
  });
  return `블로그 편집 가능 문구:\n${lines.join('\n')}`;
};
