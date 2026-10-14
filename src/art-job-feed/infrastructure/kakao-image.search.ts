import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { fetchTextWithRetry } from './fetch-text-with-retry';

const ENDPOINT = 'https://dapi.kakao.com/v2/search/image';
const PAGE_SIZE = 20;

export interface KakaoImageDocument {
  imageUrl: string;
  docUrl: string;
  sourceName: string;
  width: number;
  height: number;
}

interface RawKakaoDocument {
  image_url?: unknown;
  doc_url?: unknown;
  display_sitename?: unknown;
  width?: unknown;
  height?: unknown;
}

// 응답 형태가 바뀌어도 터지지 않게, 필드가 다 찬 문서만 남긴다.
export const parseKakaoImageSearch = (
  payload: unknown,
): KakaoImageDocument[] => {
  const documents = (payload as { documents?: unknown })?.documents;
  if (!Array.isArray(documents)) {
    return [];
  }
  return (documents as RawKakaoDocument[]).flatMap((document) => {
    const { image_url, doc_url, display_sitename, width, height } = document;
    if (
      typeof image_url !== 'string' ||
      typeof doc_url !== 'string' ||
      typeof width !== 'number' ||
      typeof height !== 'number'
    ) {
      return [];
    }
    return [
      {
        imageUrl: image_url,
        docUrl: doc_url,
        sourceName:
          typeof display_sitename === 'string' ? display_sitename : '',
        width,
        height,
      },
    ];
  });
};

// 카카오(다음) 이미지 검색. KAKAO_REST_API_KEY 가 없으면 꺼진다(무료 일 30,000건).
@Injectable()
export class KakaoImageSearch {
  constructor(private readonly configService: ConfigService) {}

  isEnabled(): boolean {
    return this.readKey() !== null;
  }

  async search(query: string): Promise<KakaoImageDocument[]> {
    const key = this.readKey();
    if (!key) {
      return [];
    }
    const parameters = new URLSearchParams({
      query,
      sort: 'accuracy',
      size: String(PAGE_SIZE),
    });
    const body = await fetchTextWithRetry({
      url: `${ENDPOINT}?${parameters.toString()}`,
      timeoutMs: 10_000,
      label: '카카오 이미지 검색',
      headers: { Authorization: `KakaoAK ${key}` },
    });
    return parseKakaoImageSearch(JSON.parse(body) as unknown);
  }

  private readKey(): string | null {
    const raw = this.configService.get<string>('KAKAO_REST_API_KEY')?.trim();
    return raw ? raw : null;
  }
}
