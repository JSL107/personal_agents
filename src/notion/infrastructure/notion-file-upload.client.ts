import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  NotionFileUploadPort,
  UploadNotionImageInput,
} from '../domain/port/notion-file-upload.port';

const FILE_UPLOAD_ENDPOINT = 'https://api.notion.com/v1/file_uploads';
// SDK(@notionhq/client@2.3.0) 가 보내는 버전은 파일 업로드를 지원하지 않을 수 있어
// 이 경로에만 별도로 명시한다. 아래 값은 실호출로 확인하지 않은 임시값 — 실제 최소 지원 버전은 Task 8 에서 확정한다.
const FILE_UPLOAD_NOTION_VERSION = '2022-06-28';
const CONTENT_TYPE_PNG = 'image/png';

interface CreatedFileUpload {
  id: string;
}

@Injectable()
export class NotionFileUploadClient implements NotionFileUploadPort {
  constructor(private readonly configService: ConfigService) {}

  async uploadImage({
    filename,
    png,
  }: UploadNotionImageInput): Promise<string> {
    const token = this.configService.get<string>('NOTION_TOKEN')?.trim();
    if (!token) {
      throw new Error('NOTION_TOKEN 이 설정되지 않아 파일을 올릴 수 없습니다.');
    }

    const created = await this.createFileUpload({ token, filename });
    await this.sendFileContent({
      token,
      fileUploadId: created.id,
      filename,
      png,
    });
    return created.id;
  }

  private async createFileUpload({
    token,
    filename,
  }: {
    token: string;
    filename: string;
  }): Promise<CreatedFileUpload> {
    const response = await fetch(FILE_UPLOAD_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': FILE_UPLOAD_NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ filename, content_type: CONTENT_TYPE_PNG }),
    });
    await assertOk(response, '파일 업로드 객체 생성');

    const body = (await response.json()) as Partial<CreatedFileUpload>;
    if (!body.id) {
      throw new Error(
        '파일 업로드 응답에 id 가 없습니다. Notion-Version 이 파일 업로드를 지원하는지 확인이 필요합니다.',
      );
    }
    return { id: body.id };
  }

  private async sendFileContent({
    token,
    fileUploadId,
    filename,
    png,
  }: {
    token: string;
    fileUploadId: string;
    filename: string;
    png: Buffer;
  }): Promise<void> {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(png)], { type: CONTENT_TYPE_PNG }),
      filename,
    );

    const response = await fetch(
      `${FILE_UPLOAD_ENDPOINT}/${fileUploadId}/send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': FILE_UPLOAD_NOTION_VERSION,
          // Content-Type 을 직접 넣지 않는다. multipart 경계 문자열은 런타임이 붙인다.
        },
        body: form,
      },
    );
    await assertOk(response, '파일 내용 전송');
  }
}

const assertOk = async (response: Response, stage: string): Promise<void> => {
  if (response.ok) {
    return;
  }
  const detail = await response.text().catch(() => '(본문 읽기 실패)');
  throw new Error(
    `Notion ${stage} 실패 (status=${response.status}): ${detail}`,
  );
};
