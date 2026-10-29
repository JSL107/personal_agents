import { posix } from 'node:path';

// 레포 사본에서 빼는 비밀 파일. 사본을 연 리뷰 모델은 레포 안 어떤 파일이든 읽고 본문에 근거로
// 인용할 수 있어서, 실수로 커밋된 자격증명이 모델과 PR 코멘트로 새지 않게 아예 풀지 않는다.
// 이름만 본다 — 코드 문자열에 박힌 키는 막지 못하지만 그런 키는 이미 diff 로도 모델에 간다.
const SECRET_FILE_NAMES = new Set(['.env', '.npmrc', '.pypirc', '.netrc']);
const SECRET_FILE_EXTENSIONS = new Set([
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.keystore',
  '.jks',
]);
const SECRET_FILE_PREFIXES = ['id_rsa', 'id_ed25519'];
// `.env.*` 중 값이 비어 있는 견본으로 쓰는 이름 — 리뷰에 필요한 설정 키 목록이라 남긴다.
const ENV_TEMPLATE_SUFFIXES = new Set(['example', 'sample', 'template']);

export const isSecretFilePath = (path: string): boolean => {
  const name = posix.basename(path);
  if (SECRET_FILE_NAMES.has(name)) {
    return true;
  }
  if (name.startsWith('.env.')) {
    return !ENV_TEMPLATE_SUFFIXES.has(name.slice('.env.'.length));
  }
  if (SECRET_FILE_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    return true;
  }
  return SECRET_FILE_EXTENSIONS.has(posix.extname(name));
};
