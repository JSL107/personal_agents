// 가구 빌더 목록. 종류 이름은 맥 앱 `FurnitureKind` 의 rawValue 와 같다.
//
// 빌더가 없는 종류는 `placeholder` 로 그린다 — 자리 크기의 상자라도 있어야 화면이 비지 않고,
// 무엇이 아직 안 만들어졌는지 한눈에 보인다(`missingKinds`).
import { makeHelper } from "../style.js";
import * as desk from "./desk.js";
import * as chairDown from "./chairDown.js";
import * as sofa2 from "./sofa2.js";
import * as plantTall from "./plantTall.js";
import * as bookshelf from "./bookshelf.js";
import * as meetingTable from "./meetingTable.js";
import * as rug from "./rug.js";
import * as coffeeMachine from "./coffeeMachine.js";
import * as coffeeTable from "./coffeeTable.js";
import * as filingCabinet from "./filingCabinet.js";
import * as lockers2 from "./lockers2.js";
import * as partitionGlass from "./partitionGlass.js";
import * as partitionLow from "./partitionLow.js";
import * as plantSmall from "./plantSmall.js";
import * as printer from "./printer.js";
import * as refrigerator from "./refrigerator.js";
import * as sinkCounter from "./sinkCounter.js";
import * as sofa3 from "./sofa3.js";
import * as trash from "./trash.js";
import * as vendingMachine from "./vendingMachine.js";
import * as waterCooler from "./waterCooler.js";
import * as whiteboard from "./whiteboard.js";
import * as clock from "./clock.js";
import * as wallLandscape from "./wallLandscape.js";
import * as wallAbstract from "./wallAbstract.js";
import * as wallCalendar from "./wallCalendar.js";
import * as wallCertificate from "./wallCertificate.js";
import * as wallPinboard from "./wallPinboard.js";
import * as wallWhiteboard from "./wallWhiteboard.js";
import * as wallShelf from "./wallShelf.js";
import * as wallMonitor from "./wallMonitor.js";
import * as wallPoster from "./wallPoster.js";
import * as wallPlantHanging from "./wallPlantHanging.js";

export const BUILDERS = {
  desk,
  chairDown,
  sofa2,
  plantTall,
  bookshelf,
  meetingTable,
  ...Object.fromEntries(rug.kinds.map((kind) => [kind, { spec: rug.spec, build: rug.buildFor(kind) }])),
  coffeeMachine,
  coffeeTable,
  filingCabinet,
  lockers2,
  partitionGlass,
  partitionLow,
  plantSmall,
  printer,
  refrigerator,
  sinkCounter,
  sofa3,
  trash,
  vendingMachine,
  waterCooler,
  whiteboard,
  clock,
  wallLandscape,
  wallAbstract,
  wallCalendar,
  wallCertificate,
  wallPinboard,
  wallWhiteboard,
  wallShelf,
  wallMonitor,
  wallPoster,
  wallPlantHanging,
};

/** 문은 벽의 빈칸으로 읽히게 두고 그리지 않는다(낮은 벽 사이 틈이 곧 문이다). */
const SKIPPED = new Set(["doorClosed", "doorOpen"]);

/** 가구 하나를 만든다. 원점은 점유 범위의 바닥 중심이다. 그리지 않는 종류면 null. */
export function buildFurniture(kind, footprint = [1, 1]) {
  if (SKIPPED.has(kind)) {
    return null;
  }
  const h = makeHelper();
  const builder = BUILDERS[kind];
  if (builder) {
    builder.build(h);
  } else {
    h.box(footprint[0] * 0.7, 0.4, footprint[1] * 0.7, "placeholder");
  }
  h.group.userData.kind = kind;
  h.group.userData.placeholder = !builder;
  return h.group;
}

/** 빌더가 아직 없는 종류 — 상태 줄과 스타일 게이트가 이 목록을 보여 준다. */
export function missingKinds(kinds) {
  return [...new Set(kinds)].filter((kind) => !BUILDERS[kind] && !SKIPPED.has(kind)).sort();
}
