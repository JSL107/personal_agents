import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isMatching, match, P } from 'ts-pattern';

import { DomainStatus } from '../../common/exception/domain-status.enum';
import {
  InstagramException,
  toInstagramError,
} from '../domain/instagram.exception';
import { InstagramErrorCode } from '../domain/instagram-error-code.enum';
import {
  EMPTY_INSIGHT_METRICS,
  InsightMetrics,
} from '../domain/instagram-insight.type';
import {
  ContainerStatus,
  ContainerStatusCode,
  InsightKind,
  MediaDetail,
  MediaInsightsResult,
  MediaInsightsResultKind,
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

// insights 응답 data 배열의 한 칸(INSIGHTS_PATTERN 과 같은 모양).
interface InsightDatum {
  name: string;
  values: { value: unknown }[];
}

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

// 한 요청에 그 상품이 지원하지 않는 지표가 하나라도 섞이면 요청 전체가 실패한다(2026-11-05 실측). 목록을 고정한다.
const INSIGHT_METRICS: Record<InsightKind, string[]> = {
  [InsightKind.REELS]: [
    'views',
    'reach',
    'likes',
    'comments',
    'shares',
    'saved',
    'total_interactions',
    'reposts',
    'ig_reels_avg_watch_time',
    'ig_reels_video_view_total_time',
    'reels_skip_rate',
  ],
  [InsightKind.STORY]: [
    'views',
    'reach',
    'replies',
    'shares',
    'total_interactions',
    'follows',
    'profile_visits',
  ],
};
// follows·profile_visits 는 스냅숏 열이 없어 raw 에만 남는다.
const METRIC_KEYS: Record<string, keyof InsightMetrics> = {
  views: 'views',
  reach: 'reach',
  likes: 'likes',
  comments: 'comments',
  shares: 'shares',
  saved: 'saved',
  total_interactions: 'totalInteractions',
  reposts: 'reposts',
  replies: 'replies',
  ig_reels_avg_watch_time: 'avgWatchMs',
  ig_reels_video_view_total_time: 'totalWatchMs',
  reels_skip_rate: 'skipRate',
};
const INSIGHTS_PATTERN = {
  data: P.array({ name: P.string, values: P.array({ value: P.unknown }) }),
};
const NOT_ENOUGH_VIEWERS_CODE = 10;
const NOT_ENOUGH_VIEWERS_MESSAGE = /not enough viewers/i;

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

  async getMediaInsights({
    mediaId,
    kind,
  }: {
    mediaId: string;
    kind: InsightKind;
  }): Promise<MediaInsightsResult> {
    // catch 는 「조회 5 미만」만 결과로 바꾸고 나머지는 그대로 던진다. 검사·변환까지 try 안에 둬도 잡는 예외가 같다.
    try {
      const body = await this.graphGet({
        path: `${mediaId}/insights`,
        params: { metric: INSIGHT_METRICS[kind].join(',') },
      });
      if (!isMatching(INSIGHTS_PATTERN, body)) {
        throw this.failure('Meta 인사이트 응답이 올바르지 않습니다.');
      }
      const result: MediaInsightsResult = {
        kind: MediaInsightsResultKind.OK,
        metrics: toMetrics(body.data),
        raw: body.data,
      };
      return result;
    } catch (error) {
      const notEnough = toInstagramError({
        error,
        code: InstagramErrorCode.INSIGHTS_NOT_ENOUGH_VIEWERS,
      });
      if (!notEnough) {
        throw error;
      }
      const result: MediaInsightsResult = {
        kind: MediaInsightsResultKind.NOT_ENOUGH_VIEWERS,
        raw: { code: NOT_ENOUGH_VIEWERS_CODE, message: notEnough.message },
      };
      return result;
    }
  }

  async getFollowersCount(): Promise<number> {
    const body = await this.graphGet({
      path: this.userId,
      params: { fields: 'followers_count' },
    });
    if (!isMatching({ followers_count: P.number }, body)) {
      throw this.failure('Meta 팔로워 수 응답이 올바르지 않습니다.');
    }
    return body.followers_count;
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
    const raw = error.error_user_msg ?? error.message ?? '알 수 없는 오류';
    const code = graphErrorCodeOf(error);
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

// (code, subcode, 메시지) 조합에서 도메인 오류 코드 하나를 고른다.
// #10 은 권한 부족에도 쓰인다. 메시지까지 보지 않으면 그 창이 「조회 5 미만」 빈 행으로 영구히 닫힌다.
const graphErrorCodeOf = (error: GraphError): InstagramErrorCode => {
  const message = `${error.message ?? ''} ${error.error_user_msg ?? ''}`;
  const code = match({
    code: error.code,
    subcode: error.error_subcode,
    notEnoughViewers: NOT_ENOUGH_VIEWERS_MESSAGE.test(message),
  })
    .with({ code: 190 }, () => InstagramErrorCode.TOKEN_INVALID)
    .with(
      { code: 9, subcode: 2207042 },
      () => InstagramErrorCode.QUOTA_EXCEEDED,
    )
    .with(
      { code: NOT_ENOUGH_VIEWERS_CODE, notEnoughViewers: true },
      () => InstagramErrorCode.INSIGHTS_NOT_ENOUGH_VIEWERS,
    )
    .otherwise(() => InstagramErrorCode.GRAPH_REQUEST_FAILED);
  return code;
};

// 응답에 없는 지표는 null 로 남긴다. Meta 는 값이 없으면 0 대신 빈 data 를 준다.
const toMetrics = (data: InsightDatum[]): InsightMetrics => {
  const metrics: InsightMetrics = { ...EMPTY_INSIGHT_METRICS };
  for (const item of data) {
    const key = METRIC_KEYS[item.name];
    const value = item.values[0]?.value;
    if (key && typeof value === 'number') {
      metrics[key] = value;
    }
  }
  return metrics;
};
