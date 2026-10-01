// 이름표 겹침 풀기 — 화면 좌표 상자를 받아 "어느 쪽으로 몇 px 비킬지" 만 돌려주는 순수 계산.
//
// 3D 이름표는 사람 머리 위 한 점에 붙는다. 회의석처럼 한 칸 간격으로 여럿이 서면 판이 포개져
// 아무 이름도 안 읽힌다. **앞(화면 아래)에 선 사람의 판은 그 자리에 두고**, 뒤에 선 사람의 판을
// 겹치지 않는 가장 가까운 자리로 옮긴다. 겹치지 않는 판은 움직이지 않는다(책상 자리 이름표는 그대로).
//
// 위로만 쌓으면 안 된다. 처음에 그렇게 했더니 문패·말풍선을 차례로 피하느라 연쇄로 밀려 넷 중 둘이
// 머리에서 150px 떨어진 벽 위에 떴다 — 이름은 읽히는데 누구 이름인지가 사라졌다. 그래서 좌우로
// 비키는 것도 후보에 넣고 **움직임이 가장 작은 자리**를 고른다(2D 문패 피하기와 같은 생각). 아래로는
// 내리지 않는다 — 판이 내려가면 그 사람 몸을 가린다.
//
// DOM·three.js 를 모르게 둔 것은 검사 때문이다(`scripts-check-labels.mjs`).

/** 한 판이 비킬 자리를 찾을 때 몇 번까지 꺾어 볼지. 후보는 매번 셋으로 갈라지므로 작게 둔다. */
const SEARCH_DEPTH = 4;
/** 한 단계에서 이어 볼 후보 수 상한(움직임이 작은 것부터). */
const FRONTIER_LIMIT = 24;
/**
 * 이만큼(px) 이하로 스친 것은 포개진 것으로 치지 않는다. 조감도의 책상 자리 이름표 셋이 문패와 **0.1px**
 * 겹쳐 있었다 — 눈에는 안 보이는 접촉인데 그것을 풀겠다고 24px 옆으로 밀었다. 판 테두리가 1px 이라
 * 3px 안쪽 접촉은 그림에서 구별되지 않는다.
 */
const TOUCH_TOLERANCE_PX = 3;

const overlaps = (a, b, gap) =>
  a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap;

const moved = (box, offset) => ({
  left: box.left + offset.dx,
  right: box.right + offset.dx,
  top: box.top + offset.dy,
  bottom: box.bottom + offset.dy,
});

/** 움직임의 크기. 같은 거리면 옆보다 위가 조금 낫다 — 위는 그 사람 머리 쪽이다. */
const cost = (offset) => Math.abs(offset.dx) + Math.abs(offset.dy) * 0.9;

/**
 * @param {{key: string, left: number, right: number, top: number, bottom: number}[]} labels 움직일 수 있는 판
 * @param {{left: number, right: number, top: number, bottom: number}[]} obstacles 움직이지 않는 글자(문패)
 * @param {number} gap 판 사이 최소 간격(px)
 * @returns {Map<string, {dx: number, dy: number}>} key → 비킬 양(px, dy 는 0 이하 = 위로).
 */
export function separateLabels(labels, obstacles, gap) {
  const placed = obstacles.map((box) => ({ ...box }));
  const offsets = new Map();
  // 앞에 선 사람(판 아래쪽이 화면 아래)부터 자리를 잡는다. 같은 줄이면 왼쪽부터 — 순서가 실행마다
  // 같아야 회의가 열릴 때마다 같은 모양으로 쌓인다.
  const order = [...labels].sort((a, b) => b.bottom - a.bottom || a.left - b.left);
  for (const label of order) {
    const offset = nearestFreeOffset(label, placed, gap);
    offsets.set(label.key, offset);
    placed.push(moved(label, offset));
  }
  return offsets;
}

function nearestFreeOffset(label, placed, gap) {
  // **눈에 보이게 포개진 판만 움직인다.** 스친 정도까지 겹침으로 치면 문패에 닿아 있던 책상 자리 이름표가
  // 옆으로 밀리고, 그 옆 판까지 연쇄로 움직여 평소 화면이 바뀐다(조감도 대조에서 잡았다). 간격은 비킬 때만 지킨다.
  if (!placed.some((box) => overlaps(label, box, -TOUCH_TOLERANCE_PX))) {
    return { dx: 0, dy: 0 };
  }
  const blockerAt = (offset) => placed.find((box) => overlaps(moved(label, offset), box, gap));
  let best = null;
  let frontier = [{ dx: 0, dy: 0 }];
  for (let depth = 0; depth <= SEARCH_DEPTH && frontier.length > 0; depth += 1) {
    const next = [];
    for (const offset of frontier) {
      if (best && cost(offset) >= cost(best)) {
        continue;
      }
      const blocker = blockerAt(offset);
      if (!blocker) {
        best = offset;
        continue;
      }
      // 막은 판의 왼쪽 바깥·오른쪽 바깥·위쪽 바깥 — 셋 다 그 판 하나는 확실히 넘는다.
      const box = moved(label, offset);
      next.push(
        { dx: offset.dx + (blocker.left - gap - box.right), dy: offset.dy },
        { dx: offset.dx + (blocker.right + gap - box.left), dy: offset.dy },
        { dx: offset.dx, dy: offset.dy - (box.bottom - blocker.top + gap) }
      );
    }
    frontier = next.sort((a, b) => cost(a) - cost(b)).slice(0, FRONTIER_LIMIT);
  }
  if (best) {
    return best;
  }
  // 몇 번 꺾어도 빈 자리가 없을 만큼 빽빽하면 위로만 쌓는다 — 멀어지더라도 겹친 채 남는 것보다 낫다.
  let dy = 0;
  for (let round = 0; round <= placed.length; round += 1) {
    const blocker = blockerAt({ dx: 0, dy });
    if (!blocker) {
      break;
    }
    dy -= label.bottom + dy - blocker.top + gap;
  }
  return { dx: 0, dy };
}
