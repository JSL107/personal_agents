// 벽걸이(액자·게시판·시계 등) — 아직 종류별 빌더가 없어 한 모양으로 건다.
// 렌더러가 가장 가까운 벽 쪽으로 붙이고 높이를 올린다. 벽걸이 규칙(`WALL_MOUNT`)을 따른다.
import { WALL_MOUNT } from "../style.js";

export const spec = { footprint: [1, 1], height: WALL_MOUNT.maxHeight, wall: true };

export function build(h) {
  const back = WALL_MOUNT.backZ;
  h.box(0.6, 0.44, 0.05, "woodMid", { z: back + 0.025 });
  h.box(0.5, 0.34, 0.02, "fabricCream", { y: 0.05, z: back + 0.06 });
}
