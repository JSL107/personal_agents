export enum SandboxErrorCode {
  // 절대경로가 아니거나 셸 메타문자가 포함된 mount path 를 거부.
  UNSAFE_MOUNT_PATH = 'SANDBOX_UNSAFE_MOUNT_PATH',
  // docker spawn 자체가 실패한 경우 (docker daemon 미구동, 바이너리 없음 등).
  DOCKER_SPAWN_FAILED = 'SANDBOX_DOCKER_SPAWN_FAILED',
  // SandboxRunRequest 필드 유효성 실패.
  INVALID_REQUEST = 'SANDBOX_INVALID_REQUEST',
}
