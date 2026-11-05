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

export interface MetaGraphPort {
  isConfigured(): boolean;
  getPublishingLimit(): Promise<PublishingLimit>;
  createReelContainer(caption: string): Promise<ReelContainer>;
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
}
