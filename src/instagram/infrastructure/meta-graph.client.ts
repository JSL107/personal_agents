import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isMatching, P } from 'ts-pattern';

import { DomainStatus } from '../../common/exception/domain-status.enum';
import {
  InstagramException,
  toInstagramError,
} from '../domain/instagram.exception';
import { InstagramErrorCode } from '../domain/instagram-error-code.enum';
import {
  ContainerStatus,
  ContainerStatusCode,
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
// 컨테이너 응답의 uri 로 페이지 토큰을 보내므로, Meta 업로드 호스트가 아니면 보내지 않는다.
const UPLOAD_HOST = 'rupload.facebook.com';
const GRAPH_ERROR_RESPONSE_PATTERN = {
  error: {
    code: P.optional(P.number),
    error_subcode: P.optional(P.number),
    message: P.optional(P.string),
    error_user_msg: P.optional(P.string),
  },
};

interface GraphError {
  code?: number;
  error_subcode?: number;
  message?: string;
  error_user_msg?: string;
}

type GraphResponse = Record<string, unknown>;

const PUBLISHING_LIMIT_PATTERN = {
  data: { 0: { quota_usage: P.number, config: { quota_total: P.number } } },
};
const CONTAINER_STATUS_PATTERN = {
  status_code: P.union(
    ContainerStatusCode.IN_PROGRESS,
    ContainerStatusCode.FINISHED,
    ContainerStatusCode.ERROR,
    ContainerStatusCode.EXPIRED,
    ContainerStatusCode.PUBLISHED,
  ),
};
const RECENT_MEDIA_PATTERN = {
  data: P.array({
    id: P.string,
    caption: P.optional(P.union(P.string, null)),
    permalink: P.string,
    timestamp: P.string,
  }),
};
const TOKEN_DEBUG_PATTERN = {
  data: {
    is_valid: P.boolean,
    expires_at: P.number,
    data_access_expires_at: P.number,
    scopes: P.array(P.string),
  },
};

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
    const body = await this.graphGet({
      path: `${this.userId}/content_publishing_limit`,
      params: { fields: 'quota_usage,config' },
    });
    if (!isMatching(PUBLISHING_LIMIT_PATTERN, body)) {
      throw this.failure('Meta 게시 한도 응답이 비어 있습니다.');
    }
    return {
      usage: body.data[0].quota_usage,
      total: body.data[0].config.quota_total,
    };
  }

  async createReelContainer({
    caption,
    thumbOffsetMs,
  }: {
    caption: string;
    thumbOffsetMs?: number;
  }): Promise<ReelContainer> {
    const params: Record<string, string> = {
      media_type: 'REELS',
      upload_type: 'resumable',
      caption,
      share_to_feed: 'true',
    };
    // 표지는 영상 안의 프레임으로만 고른다. cover_url 은 공개 서버 이미지가 필요하다(2026-11-05 Meta 문서).
    if (thumbOffsetMs !== undefined) {
      params.thumb_offset = String(thumbOffsetMs);
    }
    return await this.createResumableContainer(params);
  }

  // 스토리는 캡션을 받지 않는다. 이미지 스토리는 공개 URL 만 받아 영상으로만 올린다(2026-11-05 Meta 문서).
  async createStoryContainer(): Promise<ReelContainer> {
    return await this.createResumableContainer({
      media_type: 'STORIES',
      upload_type: 'resumable',
    });
  }

  private async createResumableContainer(
    params: Record<string, string>,
  ): Promise<ReelContainer> {
    const body = await this.graphPost({
      path: `${this.userId}/media`,
      params,
    });
    if (!isMatching({ id: P.string, uri: P.string }, body)) {
      throw this.failure('Meta 컨테이너 응답이 올바르지 않습니다.');
    }
    return { containerId: body.id, uploadUri: body.uri };
  }

  async uploadVideo({
    uploadUri,
    video,
  }: {
    uploadUri: string;
    video: Buffer;
  }): Promise<void> {
    let uploadUrl: URL;
    try {
      uploadUrl = new URL(uploadUri);
    } catch {
      throw this.failure('Meta 영상 업로드 주소가 올바르지 않습니다.');
    }
    const trustedUploadUrl =
      uploadUrl.protocol === 'https:' && uploadUrl.host === UPLOAD_HOST;
    if (!trustedUploadUrl) {
      throw this.failure('Meta 영상 업로드 주소가 올바르지 않습니다.');
    }
    const body = await this.request({
      url: uploadUri,
      init: {
        method: 'POST',
        headers: {
          Authorization: `OAuth ${this.pageToken}`,
          offset: '0',
          file_size: String(video.byteLength),
          'Content-Type': 'application/octet-stream',
        },
        body: new Uint8Array(video),
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      },
    });
    if (body.success !== true) {
      const detail = isMatching({ debug_info: { message: P.string } }, body)
        ? `: ${this.sanitize(body.debug_info.message)}`
        : '';
      throw this.failure(`Meta 영상 업로드가 실패했습니다${detail}`);
    }
  }

  async getContainerStatus(containerId: string): Promise<ContainerStatus> {
    const body = await this.graphGet({
      path: containerId,
      params: { fields: 'status_code,status' },
    });
    if (!isMatching(CONTAINER_STATUS_PATTERN, body)) {
      throw this.failure('Meta 컨테이너 상태가 올바르지 않습니다.');
    }
    return {
      statusCode: body.status_code,
      status: isMatching({ status: P.string }, body)
        ? this.sanitize(body.status)
        : null,
    };
  }

  async publish(containerId: string): Promise<PublishedMedia> {
    const body = await this.graphPost({
      path: `${this.userId}/media_publish`,
      params: { creation_id: containerId },
    });
    if (!isMatching({ id: P.string }, body)) {
      throw this.failure('Meta 게시 응답에 id 가 없습니다.');
    }
    return {
      mediaId: body.id,
      configIssue: isMatching({ config_issue: P.string }, body)
        ? this.sanitize(body.config_issue)
        : null,
    };
  }

  async getMedia(mediaId: string): Promise<MediaDetail> {
    const body = await this.graphGet({
      path: mediaId,
      params: { fields: 'permalink,timestamp' },
    });
    if (!isMatching({ permalink: P.string, timestamp: P.string }, body)) {
      throw this.failure('Meta 게시물 응답이 올바르지 않습니다.');
    }
    return { permalink: body.permalink, timestamp: body.timestamp };
  }

  async listRecentMedia(limit: number): Promise<RecentMedia[]> {
    const body = await this.graphGet({
      path: `${this.userId}/media`,
      params: {
        fields: 'id,caption,permalink,timestamp',
        limit: String(limit),
      },
    });
    if (!isMatching(RECENT_MEDIA_PATTERN, body)) {
      throw this.failure('Meta 최근 게시물 응답이 올바르지 않습니다.');
    }
    return body.data.map((record) => ({
      id: record.id,
      caption: record.caption ?? null,
      permalink: record.permalink,
      timestamp: record.timestamp,
    }));
  }

  async debugPageToken(): Promise<PageTokenDebug> {
    const appToken = `${this.configService.get<string>('META_APP_ID')}|${this.configService.get<string>('META_APP_SECRET')}`;
    const body = await this.fetchTokenDebug(appToken);
    if (isMatching({ data: { is_valid: false } }, body)) {
      return {
        isValid: false,
        expiresAt: 0,
        dataAccessExpiresAt: 0,
        scopes: [],
      };
    }
    if (!isMatching(TOKEN_DEBUG_PATTERN, body)) {
      throw this.failure('Meta 토큰 점검 응답이 비어 있습니다.');
    }
    return {
      isValid: body.data.is_valid,
      expiresAt: body.data.expires_at,
      dataAccessExpiresAt: body.data.data_access_expires_at,
      scopes: body.data.scopes,
    };
  }

  // debug_token 의 access_token 은 앱 토큰이라, 여기서 난 190 은 페이지 토큰이 아니라 앱 자격증명 문제다.
  private async fetchTokenDebug(appToken: string): Promise<GraphResponse> {
    try {
      return await this.graphGet({
        path: 'debug_token',
        params: { input_token: this.pageToken },
        token: appToken,
      });
    } catch (error) {
      const appTokenError = toInstagramError({
        error,
        code: InstagramErrorCode.TOKEN_INVALID,
      });
      if (appTokenError) {
        throw this.failure(
          `Meta 앱 토큰 오류: META_APP_ID/META_APP_SECRET 확인. ${appTokenError.message}`,
        );
      }
      throw error;
    }
  }

  private get userId(): string {
    return this.configService.get<string>('INSTAGRAM_USER_ID') ?? '';
  }

  private get pageToken(): string {
    return this.configService.get<string>('META_PAGE_TOKEN') ?? '';
  }

  private async graphGet({
    path,
    params,
    token,
  }: {
    path: string;
    params: Record<string, string>;
    token?: string;
  }): Promise<GraphResponse> {
    const query = new URLSearchParams({
      ...params,
      access_token: token ?? this.pageToken,
    });
    return await this.request({
      url: `${GRAPH_ROOT}/${path}?${query}`,
      init: { signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS) },
    });
  }

  private async graphPost({
    path,
    params,
  }: {
    path: string;
    params: Record<string, string>;
  }): Promise<GraphResponse> {
    const form = new URLSearchParams({
      ...params,
      access_token: this.pageToken,
    });
    return await this.request({
      url: `${GRAPH_ROOT}/${path}`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
      },
    });
  }

  private async request({
    url,
    init,
  }: {
    url: string;
    init: RequestInit;
  }): Promise<GraphResponse> {
    try {
      const response = await fetch(url, init);
      const value: unknown = await response.json();
      if (!isMatching(P.record(P.string, P.unknown), value)) {
        throw this.failure('Meta 요청 응답이 올바르지 않습니다.');
      }
      const body = value;
      if (isMatching({ error: P.nonNullable }, body)) {
        if (!isMatching(GRAPH_ERROR_RESPONSE_PATTERN, body)) {
          throw this.failure('Meta 오류 응답이 올바르지 않습니다.');
        }
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
