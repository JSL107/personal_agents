export const PUBLIC_VIDEO_HOST_PORT = Symbol('PUBLIC_VIDEO_HOST_PORT');

export interface PublicVideo {
  url: string;
  close(): Promise<void>;
}

// Meta 가 video_url 로 영상을 가져가는 동안만 영상을 공개 주소로 내준다. 다 쓰면 close 로 닫는다.
export interface PublicVideoHostPort {
  open(video: Buffer): Promise<PublicVideo>;
}
