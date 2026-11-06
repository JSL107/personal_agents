import { InstagramPost as InstagramPostRow } from '@prisma/client';

import { InstagramPostStatus } from '../domain/instagram-post.type';
import { toDomain } from './instagram-post.prisma.repository';

const row: InstagramPostRow = {
  id: 'post-1',
  reelKey: '2026-11-05/ai',
  field: 'ai',
  title: 'title',
  videoPath: '/video',
  videoSha256: 'hash',
  caption: 'caption',
  previewActionId: 'card-1',
  containerId: null,
  containerCreatedAt: null,
  uploadedAt: null,
  publishAttemptedAt: null,
  mediaId: null,
  permalink: null,
  status: 'PENDING',
  lastError: null,
  publishedAt: null,
  features: null,
  createdAt: new Date('2026-11-05T00:00:00Z'),
  updatedAt: new Date('2026-11-05T00:00:00Z'),
};

describe('toDomain', () => {
  it('version 1 특성은 그대로, 형식이 다른 특성은 null 로 읽는다', () => {
    expect(toDomain({ ...row, features: { version: 1 } }).features).toEqual({
      version: 1,
    });
    expect(toDomain({ ...row, features: { version: 2 } }).features).toBeNull();
    expect(toDomain({ ...row, features: 'x' }).features).toBeNull();
  });

  it('저장된 상태 문자열을 도메인 enum으로 변환한다', () => {
    expect(toDomain(row)).toEqual({
      ...row,
      status: InstagramPostStatus.PENDING,
    });
  });

  it.each(['daily', 'story'])('하루 1편 분야 %s 를 읽는다', (field) => {
    expect(toDomain({ ...row, field }).field).toBe(field);
  });

  it('알 수 없는 분야가 저장되면 변환을 거절한다', () => {
    expect(() => toDomain({ ...row, field: 'other' })).toThrow(
      '알 수 없는 InstagramPost field: other',
    );
  });

  it('알 수 없는 상태가 저장되면 변환을 거절한다', () => {
    expect(() => toDomain({ ...row, status: 'OTHER' })).toThrow(
      '알 수 없는 InstagramPost status: OTHER',
    );
  });
});
