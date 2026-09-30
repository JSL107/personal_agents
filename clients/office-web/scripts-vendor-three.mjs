// three.js 를 `vendor/three/` 로 복사한다.
//
// 이 앱에는 번들러가 없다 — 브라우저가 ES 모듈을 그대로 읽고, `index.html` 의 import map 이
// `three` 를 이 폴더로 돌린다. node 쪽 스타일 게이트(`scripts-check-style.mjs`)는 같은 버전을
// `node_modules/three` 에서 읽으므로, 버전을 올릴 때는 `package.json` 을 바꾸고 이것을 다시 돌린다.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const source = "node_modules/three";
const target = "vendor/three";
const files = [
  ["build/three.module.js", "three.module.js"],
  ["build/three.core.js", "three.core.js"],
  ["examples/jsm/geometries/RoundedBoxGeometry.js", "addons/geometries/RoundedBoxGeometry.js"],
  ["examples/jsm/renderers/CSS2DRenderer.js", "addons/renderers/CSS2DRenderer.js"],
  ["LICENSE", "LICENSE"],
];
for (const [from, to] of files) {
  mkdirSync(dirname(join(target, to)), { recursive: true });
  copyFileSync(join(source, from), join(target, to));
}
const { version } = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
console.log(`three ${version} → ${target} (${files.length} 파일)`);
