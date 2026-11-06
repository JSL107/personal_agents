import { InsightMetrics } from '../instagram-insight.type';

export const META_GRAPH_PORT = Symbol('META_GRAPH_PORT');

export interface PublishingLimit {
  usage: number;
  total: number;
}

export interface ReelContainer {
  containerId: string;
  uploadUri: string;
}

export enum ContainerStatusCode {
  IN_PROGRESS = 'IN_PROGRESS',
  FINISHED = 'FINISHED',
  ERROR = 'ERROR',
  EXPIRED = 'EXPIRED',
  PUBLISHED = 'PUBLISHED',
}

export interface ContainerStatus {
  statusCode: ContainerStatusCode;
  status: string | null;
}

export interface PublishedMedia {
  mediaId: string;
  configIssue: string | null;
}

export interface MediaDetail {
  permalink: string;
  timestamp: string;
}

export interface RecentMedia extends MediaDetail {
  id: string;
  caption: string | null;
}

export interface PageTokenDebug {
  isValid: boolean;
  expiresAt: number;
  dataAccessExpiresAt: number;
  scopes: string[];
}

export enum InsightKind {
  REELS = 'REELS',
  STORY = 'STORY',
}

export enum MediaInsightsResultKind {
  OK = 'OK',
  NOT_ENOUGH_VIEWERS = 'NOT_ENOUGH_VIEWERS',
}

// 스토리는 값이 5 미만이면 Meta 가 (#10) 오류를 준다. 다시 물어도 같으므로 실패가 아니라 결과로 돌려준다.
// kind 로 좁혀야 metrics 를 읽을 수 있다. 조회 5 미만인데 지표를 읽는 실수를 컴파일러가 막는다.
export interface MediaInsightsOk {
  kind: MediaInsightsResultKind.OK;
  metrics: InsightMetrics;
  raw: unknown;
}

export interface MediaInsightsNotEnoughViewers {
  kind: MediaInsightsResultKind.NOT_ENOUGH_VIEWERS;
  raw: unknown;
}

export type MediaInsightsResult =
  | MediaInsightsOk
  | MediaInsightsNotEnoughViewers;

export interface MetaGraphPort {
  isConfigured(): boolean;
  getPublishingLimit(): Promise<PublishingLimit>;
  createReelContainer({
    caption,
    thumbOffsetMs,
  }: {
    caption: string;
    thumbOffsetMs?: number;
  }): Promise<ReelContainer>;
  createStoryContainer(): Promise<ReelContainer>;
  uploadVideo({
    uploadUri,
    video,
  }: {
    uploadUri: string;
    video: Buffer;
  }): Promise<void>;
  getContainerStatus(containerId: string): Promise<ContainerStatus>;
  publish(containerId: string): Promise<PublishedMedia>;
  getMedia(mediaId: string): Promise<MediaDetail>;
  listRecentMedia(limit: number): Promise<RecentMedia[]>;
  debugPageToken(): Promise<PageTokenDebug>;
  getMediaInsights({
    mediaId,
    kind,
  }: {
    mediaId: string;
    kind: InsightKind;
  }): Promise<MediaInsightsResult>;
  getFollowersCount(): Promise<number>;
}
