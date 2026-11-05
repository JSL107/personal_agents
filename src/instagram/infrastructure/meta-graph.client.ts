import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DomainStatus } from '../../common/exception/domain-status.enum';
import { InstagramException } from '../domain/instagram.exception';
import { InstagramErrorCode } from '../domain/instagram-error-code.enum';
import {
  ContainerStatus,
  MediaDetail,
  MetaGraphPort,
  PageTokenDebug,
  PublishedMedia,
  PublishingLimit,
  RecentMedia,
  ReelContainer,
} from '../domain/port/meta-graph.port';

const GRAPH_ROOT = 'https://graph.facebook.com/v27.0';
const GRAPH_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 120_000;

interface GraphError {
  code?: number;
  error_subcode?: number;
  message?: string;
  error_user_msg?: string;
}

interface GraphResponse {
  error?: GraphError;
  [key: string]: unknown;
}

@Injectable()
export class MetaGraphClient implements MetaGraphPort {
  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    if (
      this.configService.get<string>('INSTAGRAM_PUBLISH_ENABLED') !== 'true'
    ) {
      return false;
    }
    const keys = [
      'META_APP_ID',
      'META_APP_SECRET',
      'META_PAGE_TOKEN',
      'INSTAGRAM_USER_ID',
    ];
    return keys.every((key) =>
      Boolean(this.configService.get<string>(key)?.trim()),
    );
  }

  async getPublishingLimit(): Promise<PublishingLimit> {
    const body = await this.graphGet(
      `${this.userId}/content_publishing_limit`,
      { fields: 'quota_usage,config' },
    );
    const data = body.data as Array<{
      quota_usage: number;
      config: { quota_total: number };
    }>;
    if (
      !data?.[0] ||
      typeof data[0].quota_usage !== 'number' ||
      typeof data[0].config?.quota_total !== 'number'
    ) {
      throw this.failure('Meta 게시 한도 응답이 비어 있습니다.');
    }
    return { usage: data[0].quota_usage, total: data[0].config.quota_total };
  }

  async createReelContainer(caption: string): Promise<ReelContainer> {
    const body = await this.graphPost(`${this.userId}/media`, {
      media_type: 'REELS',
      upload_type: 'resumable',
      caption,
      share_to_feed: 'true',
    });
    if (typeof body.id !== 'string' || typeof body.uri !== 'string') {
      throw this.failure('Meta 컨테이너 응답이 올바르지 않습니다.');
    }
    return { containerId: body.id, uploadUri: body.uri };
  }

  async uploadVideo(uploadUri: string, video: Buffer): Promise<void> {
    let uploadUrl: URL;
    try {
      uploadUrl = new URL(uploadUri);
    } catch {
      throw this.failure('Meta 영상 업로드 주소가 올바르지 않습니다.');
    }
    if (
      uploadUrl.protocol !== 'https:' ||
      uploadUrl.host !== 'rupload.facebook.com'
    ) {
      throw this.failure('Meta 영상 업로드 주소가 올바르지 않습니다.');
    }
    const body = await this.request(uploadUri, {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${this.pageToken}`,
        offset: '0',
        file_size: String(video.byteLength),
        'Content-Type': 'application/octet-stream',
      },
      body: new Uint8Array(video),
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    if (body.success !== true) {
      const debugInfo = body.debug_info as GraphResponse | undefined;
      const detail =
        typeof debugInfo?.message === 'string'
          ? `: ${this.sanitize(debugInfo.message)}`
          : '';
      throw this.failure(`Meta 영상 업로드가 실패했습니다${detail}`);
    }
  }

  async getContainerStatus(containerId: string): Promise<ContainerStatus> {
    const body = await this.graphGet(containerId, {
      fields: 'status_code,status',
    });
    const statusCode = body.status_code as ContainerStatus['statusCode'];
    if (
      !['IN_PROGRESS', 'FINISHED', 'ERROR', 'EXPIRED', 'PUBLISHED'].includes(
        statusCode,
      )
    ) {
      throw this.failure('Meta 컨테이너 상태가 올바르지 않습니다.');
    }
    return {
      statusCode,
      status:
        typeof body.status === 'string' ? this.sanitize(body.status) : null,
    };
  }

  async publish(containerId: string): Promise<PublishedMedia> {
    const body = await this.graphPost(`${this.userId}/media_publish`, {
      creation_id: containerId,
    });
    if (typeof body.id !== 'string') {
      throw this.failure('Meta 게시 응답에 id 가 없습니다.');
    }
    return {
      mediaId: body.id,
      configIssue:
        typeof body.config_issue === 'string'
          ? this.sanitize(body.config_issue)
          : null,
    };
  }

  async getMedia(mediaId: string): Promise<MediaDetail> {
    const body = await this.graphGet(mediaId, {
      fields: 'permalink,timestamp',
    });
    if (
      typeof body.permalink !== 'string' ||
      typeof body.timestamp !== 'string'
    ) {
      throw this.failure('Meta 게시물 응답이 올바르지 않습니다.');
    }
    return { permalink: body.permalink, timestamp: body.timestamp };
  }

  async listRecentMedia(limit: number): Promise<RecentMedia[]> {
    const body = await this.graphGet(`${this.userId}/media`, {
      fields: 'id,caption,permalink,timestamp',
      limit: String(limit),
    });
    if (!Array.isArray(body.data)) {
      throw this.failure('Meta 최근 게시물 응답이 올바르지 않습니다.');
    }
    const records = body.data as GraphResponse[];
    if (
      records.some(
        (record) =>
          typeof record.id !== 'string' ||
          typeof record.permalink !== 'string' ||
          typeof record.timestamp !== 'string' ||
          (record.caption != null && typeof record.caption !== 'string'),
      )
    ) {
      throw this.failure('Meta 최근 게시물 응답이 올바르지 않습니다.');
    }
    return records.map((record) => ({
      id: record.id as string,
      caption: typeof record.caption === 'string' ? record.caption : null,
      permalink: record.permalink as string,
      timestamp: record.timestamp as string,
    }));
  }

  async debugPageToken(): Promise<PageTokenDebug> {
    const appToken = `${this.configService.get<string>('META_APP_ID')}|${this.configService.get<string>('META_APP_SECRET')}`;
    let body: GraphResponse;
    try {
      body = await this.graphGet(
        'debug_token',
        { input_token: this.pageToken },
        appToken,
      );
    } catch (error) {
      if (
        error instanceof InstagramException &&
        error.instagramErrorCode === InstagramErrorCode.TOKEN_INVALID
      ) {
        throw this.failure(
          `Meta 앱 토큰 오류: META_APP_ID/META_APP_SECRET 확인. ${error.message}`,
        );
      }
      throw error;
    }
    const data = body.data as {
      is_valid: boolean;
      expires_at: number;
      data_access_expires_at: number;
      scopes: string[];
    };
    if (data?.is_valid === false) {
      return {
        isValid: false,
        expiresAt: 0,
        dataAccessExpiresAt: 0,
        scopes: [],
      };
    }
    if (
      !data ||
      typeof data.is_valid !== 'boolean' ||
      typeof data.expires_at !== 'number' ||
      typeof data.data_access_expires_at !== 'number' ||
      !Array.isArray(data.scopes) ||
      data.scopes.some((scope) => typeof scope !== 'string')
    ) {
      throw this.failure('Meta 토큰 점검 응답이 비어 있습니다.');
    }
    return {
      isValid: data.is_valid,
      expiresAt: data.expires_at,
      dataAccessExpiresAt: data.data_access_expires_at,
      scopes: data.scopes,
    };
  }

  private get userId(): string {
    return this.configService.get<string>('INSTAGRAM_USER_ID') ?? '';
  }

  private get pageToken(): string {
    return this.configService.get<string>('META_PAGE_TOKEN') ?? '';
  }

  private async graphGet(
    path: string,
    params: Record<string, string>,
    token = this.pageToken,
  ): Promise<GraphResponse> {
    const query = new URLSearchParams({ ...params, access_token: token });
    return await this.request(`${GRAPH_ROOT}/${path}?${query}`, {
      signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
    });
  }

  private async graphPost(
    path: string,
    params: Record<string, string>,
  ): Promise<GraphResponse> {
    const form = new URLSearchParams({
      ...params,
      access_token: this.pageToken,
    });
    return await this.request(`${GRAPH_ROOT}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
    });
  }

  private async request(
    url: string,
    init: RequestInit,
  ): Promise<GraphResponse> {
    try {
      const response = await fetch(url, init);
      const body = (await response.json()) as GraphResponse;
      if (body.error) {
        throw this.graphFailure(body.error);
      }
      if (!response.ok) {
        throw this.failure(`Meta 요청 실패: HTTP ${response.status}`);
      }
      return body;
    } catch (error) {
      if (error instanceof InstagramException) {
        throw error;
      }
      const name = error instanceof Error ? error.name : 'UnknownError';
      throw this.failure(`Meta 요청 실패: ${name}`);
    }
  }

  private graphFailure(error: GraphError): InstagramException {
    const code =
      error.code === 190
        ? InstagramErrorCode.TOKEN_INVALID
        : error.code === 9 && error.error_subcode === 2207042
          ? InstagramErrorCode.QUOTA_EXCEEDED
          : InstagramErrorCode.GRAPH_REQUEST_FAILED;
    const raw = error.error_user_msg ?? error.message ?? '알 수 없는 오류';
    const safe = this.sanitize(raw);
    const message = `Meta 오류 ${error.code ?? 'unknown'}/${error.error_subcode ?? 'unknown'}: ${safe}`;
    return new InstagramException({
      code,
      message,
      status: DomainStatus.BAD_GATEWAY,
    });
  }

  private failure(message: string): InstagramException {
    return new InstagramException({
      code: InstagramErrorCode.GRAPH_REQUEST_FAILED,
      message,
      status: DomainStatus.BAD_GATEWAY,
    });
  }

  private sanitize(message: string): string {
    const tokens = [
      this.pageToken,
      this.configService.get<string>('META_APP_SECRET') ?? '',
    ].filter(Boolean);
    let safe = message.replace(/https?:\/\/\S+/g, '[URL]');
    for (const token of tokens) {
      safe = safe.split(token).join('[REDACTED]');
    }
    return safe;
  }
}
