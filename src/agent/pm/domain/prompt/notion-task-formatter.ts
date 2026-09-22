import { wrapUntrustedInput } from '../../../../common/llm/untrusted-input.util';
import { NotionTask } from '../../../../notion/domain/notion.type';

export const MAX_NOTION_ITEMS = 30;

export interface NotionFormatResult {
  content: string;
  truncatedCount: number;
}

// Notion task DB 의 row 들을 PM prompt section 으로 변환.
// 속성 schema 는 DB 마다 달라서 generic 표기 — title 강조 + 모든 non-empty property 를 콤마 구분으로.
// 항목 수가 maxItems 초과 시 앞에서부터만 표기하고 나머지는 "(+N건 생략)" 으로 cap (prompt context overflow 방어).
export const formatNotionTasksAsPromptSection = (
  tasks: NotionTask[],
  options: { maxItems?: number } = {},
): NotionFormatResult => {
  const maxItems = options.maxItems ?? MAX_NOTION_ITEMS;
  // 라벨·생략 안내는 경계 밖, 페이지에서 읽어온 값만 경계 안 (github-task-formatter 와 같은 규칙).
  const header = '[Notion task DB 의 항목]';
  const lines: string[] = [];

  // 대상 DB 조회가 전부 실패하면 client 가 예외로 끊으므로 (권한 미부여 / not_found) 여기 0건은
  // "조회는 됐는데 컷오프 안에 항목이 없다" 는 뜻이다. DB 가 2개 이상이고 일부만 실패한 경우는
  // 여전히 skip + warn 이라 이 문구로 합류할 수 있다 — 그 구분은 로그가 들고 있다.
  if (tasks.length === 0) {
    return {
      content: [header, '(없음 — 컷오프 기간 내 편집된 항목이 없음)'].join(
        '\n',
      ),
      truncatedCount: 0,
    };
  }

  const visible = tasks.slice(0, maxItems);
  const truncatedCount = Math.max(0, tasks.length - maxItems);

  for (const task of visible) {
    const propsLine = formatPropertiesInline(task.properties);
    const propsTail = propsLine ? ` — ${propsLine}` : '';
    lines.push(`- "${task.title}"${propsTail}`);
  }

  // title 과 property 값은 그 DB 에 쓰기 권한이 있는 누구나 정할 수 있다 — 공유 DB 면
  // 내가 쓰지 않은 문자열이 그대로 들어온다. 항목 전체를 감싼다.
  const tail =
    truncatedCount > 0
      ? [
          `(+${truncatedCount}건 생략 — 총 ${tasks.length}건 중 ${maxItems}건만 표기)`,
        ]
      : [];

  return {
    content: [header, wrapUntrustedInput(lines.join('\n')), ...tail].join('\n'),
    truncatedCount,
  };
};

const formatPropertiesInline = (properties: Record<string, string>): string => {
  const entries = Object.entries(properties).filter(
    ([, value]) => value && value.length > 0,
  );
  if (entries.length === 0) {
    return '';
  }
  return entries.map(([key, value]) => `${key}: ${value}`).join(', ');
};
