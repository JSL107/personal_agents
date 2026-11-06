import { InsightSnapshot, NewInsightSnapshot } from '../instagram-insight.type';

export const INSTAGRAM_INSIGHT_SNAPSHOT_REPOSITORY_PORT = Symbol(
  'INSTAGRAM_INSIGHT_SNAPSHOT_REPOSITORY_PORT',
);
export interface InstagramInsightSnapshotRepositoryPort {
  // 새로 넣으면 true. 같은 (게시물, 창) 이 이미 있으면 false — 두 인스턴스가 같은 창을 찍어도 하나만 남는다.
  insertIfAbsent(snapshot: NewInsightSnapshot): Promise<boolean>;
  listByPostIds(postIds: string[]): Promise<InsightSnapshot[]>;
}
