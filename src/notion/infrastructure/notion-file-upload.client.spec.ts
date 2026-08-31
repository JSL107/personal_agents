import { ConfigService } from '@nestjs/config';

import { NotionFileUploadClient } from './notion-file-upload.client';

const buildConfigService = (
  values: Record<string, string | undefined>,
): ConfigService =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('NotionFileUploadClient', () => {
  const png = Buffer.from('fake-png-bytes');
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  const okJson = (body: unknown): Response =>
    ({
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }) as unknown as Response;

  it('생성 → 전송 두 단계를 거쳐 file_upload id 를 돌려준다', async () => {
    fetchMock
      .mockResolvedValueOnce(
        okJson({ id: 'upload-1', upload_url: 'https://upload.example/put' }),
      )
      .mockResolvedValueOnce(okJson({ id: 'upload-1', status: 'uploaded' }));
    const client = new NotionFileUploadClient(
      buildConfigService({ NOTION_TOKEN: 'secret-token' }),
    );

    const fileUploadId = await client.uploadImage({
      filename: 'diagram.png',
      png,
    });

    expect(fileUploadId).toBe('upload-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('첫 호출은 filename 과 content_type 을 보낸다', async () => {
    fetchMock
      .mockResolvedValueOnce(
        okJson({ id: 'upload-2', upload_url: 'https://upload.example/put' }),
      )
      .mockResolvedValueOnce(okJson({ status: 'uploaded' }));
    const client = new NotionFileUploadClient(
      buildConfigService({ NOTION_TOKEN: 'secret-token' }),
    );

    await client.uploadImage({ filename: 'diagram.png', png });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.notion.com/v1/file_uploads');
    expect(JSON.parse(init.body)).toEqual({
      filename: 'diagram.png',
      content_type: 'image/png',
    });
  });

  it('모든 호출에 인증과 Notion-Version 헤더를 붙인다', async () => {
    fetchMock
      .mockResolvedValueOnce(
        okJson({ id: 'upload-3', upload_url: 'https://upload.example/put' }),
      )
      .mockResolvedValueOnce(okJson({ status: 'uploaded' }));
    const client = new NotionFileUploadClient(
      buildConfigService({ NOTION_TOKEN: 'secret-token' }),
    );

    await client.uploadImage({ filename: 'diagram.png', png });

    for (const [, init] of fetchMock.mock.calls) {
      expect(init.headers.Authorization).toBe('Bearer secret-token');
      expect(init.headers['Notion-Version']).toEqual(expect.any(String));
    }
  });

  it('전송 단계는 multipart 로 보내고 JSON Content-Type 을 붙이지 않는다', async () => {
    fetchMock
      .mockResolvedValueOnce(
        okJson({ id: 'upload-4', upload_url: 'https://upload.example/put' }),
      )
      .mockResolvedValueOnce(okJson({ status: 'uploaded' }));
    const client = new NotionFileUploadClient(
      buildConfigService({ NOTION_TOKEN: 'secret-token' }),
    );

    await client.uploadImage({ filename: 'diagram.png', png });

    const [, sendInit] = fetchMock.mock.calls[1];
    expect(sendInit.body).toBeInstanceOf(FormData);
    expect(sendInit.headers['Content-Type']).toBeUndefined();
  });

  it('NOTION_TOKEN 이 없으면 호출 전에 끊는다', async () => {
    const client = new NotionFileUploadClient(buildConfigService({}));

    await expect(
      client.uploadImage({ filename: 'diagram.png', png }),
    ).rejects.toThrow(/NOTION_TOKEN/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('생성 단계가 실패하면 상태코드와 본문을 담아 던진다', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => '{"message":"bad request"}',
    } as unknown as Response);
    const client = new NotionFileUploadClient(
      buildConfigService({ NOTION_TOKEN: 'secret-token' }),
    );

    await expect(
      client.uploadImage({ filename: 'diagram.png', png }),
    ).rejects.toThrow(/400/);
  });

  it('전송 단계가 실패하면 던진다', async () => {
    fetchMock
      .mockResolvedValueOnce(
        okJson({ id: 'upload-5', upload_url: 'https://upload.example/put' }),
      )
      .mockResolvedValueOnce({
        ok: false,
        status: 413,
        text: async () => 'too large',
      } as unknown as Response);
    const client = new NotionFileUploadClient(
      buildConfigService({ NOTION_TOKEN: 'secret-token' }),
    );

    await expect(
      client.uploadImage({ filename: 'diagram.png', png }),
    ).rejects.toThrow(/413/);
  });

  it('생성 요청이 상한을 넘겨 AbortError 가 나면 그대로 전달된다', async () => {
    fetchMock.mockRejectedValueOnce(
      new DOMException('The operation was aborted.', 'AbortError'),
    );
    const client = new NotionFileUploadClient(
      buildConfigService({ NOTION_TOKEN: 'secret-token' }),
    );

    await expect(
      client.uploadImage({ filename: 'diagram.png', png }),
    ).rejects.toThrow('The operation was aborted.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('전송 요청이 상한을 넘겨 AbortError 가 나면 그대로 전달된다', async () => {
    fetchMock
      .mockResolvedValueOnce(
        okJson({ id: 'upload-6', upload_url: 'https://upload.example/put' }),
      )
      .mockRejectedValueOnce(
        new DOMException('The operation was aborted.', 'AbortError'),
      );
    const client = new NotionFileUploadClient(
      buildConfigService({ NOTION_TOKEN: 'secret-token' }),
    );

    await expect(
      client.uploadImage({ filename: 'diagram.png', png }),
    ).rejects.toThrow('The operation was aborted.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('생성·전송 두 요청 모두 AbortSignal 을 붙인다', async () => {
    fetchMock
      .mockResolvedValueOnce(
        okJson({ id: 'upload-7', upload_url: 'https://upload.example/put' }),
      )
      .mockResolvedValueOnce(okJson({ status: 'uploaded' }));
    const client = new NotionFileUploadClient(
      buildConfigService({ NOTION_TOKEN: 'secret-token' }),
    );

    await client.uploadImage({ filename: 'diagram.png', png });

    for (const [, init] of fetchMock.mock.calls) {
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('id 없이 성공 응답이 오면 던진다', async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({ upload_url: 'https://upload.example/put' }),
    );
    const client = new NotionFileUploadClient(
      buildConfigService({ NOTION_TOKEN: 'secret-token' }),
    );

    await expect(
      client.uploadImage({ filename: 'diagram.png', png }),
    ).rejects.toThrow(/id/);
  });
});
