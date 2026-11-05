export const META_GRAPH_PORT = Symbol('META_GRAPH_PORT');

export interface PublishingLimit {
  usage: number;
  total: number;
}

export interface ReelContainer {
  containerId: string;
  uploadUri: string;
}

export interface ContainerStatus {
  statusCode: 'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED' | 'PUBLISHED';
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
  uploadVideo(uploadUri: string, video: Buffer): Promise<void>;
  getContainerStatus(containerId: string): Promise<ContainerStatus>;
  publish(containerId: string): Promise<PublishedMedia>;
  getMedia(mediaId: string): Promise<MediaDetail>;
  listRecentMedia(limit: number): Promise<RecentMedia[]>;
  debugPageToken(): Promise<PageTokenDebug>;
}
