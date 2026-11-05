// 페이지가 속한 워크스페이스 — 통합은 자기 워크스페이스만 읽으므로 상태 확인 때 쓸 Client 를 이것으로 고른다.
export enum NotionWorkspace {
  PERSONAL = 'PERSONAL',
  WORK = 'WORK',
}

// DB 에 문자열로 남은 값을 되읽는다 — 모르는 값은 "모름" 으로 두어 양쪽 통합을 다 시도하게 한다.
export const toNotionWorkspace = (
  value: string | null | undefined,
): NotionWorkspace | null =>
  Object.values(NotionWorkspace).find((workspace) => workspace === value) ??
  null;

// Notion DB 의 한 row(=page) 를 PM Agent 가 활용할 수 있는 형태로 narrow.
// 속성 schema 는 DB 마다 다르므로 title 만 우선 추출하고 나머지는 raw key-value 로 노출 — 모델이 알아서 해석.
export interface NotionTask {
  databaseId: string;
  workspace: NotionWorkspace;
  pageId: string;
  url: string;
  title: string;
  // 사람이 읽기 좋은 라벨 → 사람이 읽기 좋은 값. 빈 속성은 미포함.
  // 예: { "상태": "진행중", "우선순위": "높음", "담당자": "김준석" }
  properties: Record<string, string>;
}
