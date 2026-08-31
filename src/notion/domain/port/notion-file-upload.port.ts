export const NOTION_FILE_UPLOAD_PORT = Symbol('NOTION_FILE_UPLOAD_PORT');

export interface UploadNotionImageInput {
  filename: string;
  png: Buffer;
}

export interface NotionFileUploadPort {
  // 반환값은 Notion file_upload id. 1시간 안에 블록에 첨부하지 않으면 자동 폐기된다.
  uploadImage(input: UploadNotionImageInput): Promise<string>;
}
