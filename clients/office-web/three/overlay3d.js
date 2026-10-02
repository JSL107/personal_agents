// 글자 겹침층 — 이름표·말풍선·문패·세션 이름·요약 줄을 3D 화면 위에 HTML 로 얹는다.
//
// 글자를 WebGL 로 그리면 한글이 흐리게 뭉개진다(2D 시절 Menlo 대체 글꼴 사고와 같은 종류).
// HTML 은 운영체제 글꼴로 선명하게 그려지고, three.js 의 CSS2DRenderer 가 3D 좌표를 따라
// 위치만 맞춰 준다. 겹침층은 마우스를 통과시킨다 — 클릭·hover 는 캔버스가 받는다.

import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";

const STYLE_ID = "office3d-overlay-style";

/**
 * 말풍선·접수 대기 점을 이름표 위로 올리는 양(px). CSS 와 겹침 풀기(`renderer3d.js` 의 `separateLabels`)가
 * 같은 값을 써야 한다 — 계산이 다른 숫자를 쓰면 말풍선 자리를 잘못 재 이웃 판과 다시 포개진다.
 */
export const BUBBLE_RAISE_PX = 30;
export const DOTS_RAISE_PX = 28;

/** 겹침층 글자 모양. 한 곳에 모아 두면 판마다 굵기·모서리가 어긋나지 않는다. */
const STYLE = `
.office3d-overlay { position: absolute; pointer-events: none; overflow: hidden; }
.office3d-overlay * { pointer-events: none; }
.office3d-label {
  font: 600 12px/1.3 "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
  padding: 2px 7px; border-radius: 6px; white-space: nowrap;
  background: rgba(38, 30, 25, 0.82); color: #fbf6ee;
  border: 1px solid rgba(255, 255, 255, 0.12);
  transform: translateY(-50%);
}
.office3d-label.idle { background: rgba(38, 30, 25, 0.45); color: rgba(251, 246, 238, 0.7); }
.office3d-label.alert { background: rgba(150, 38, 62, 0.9); }
/* 회의석에 모인 사람 — 한 칸 간격이라 보통 크기면 판이 서로 밀려 누구 머리 위인지 흐려진다. */
.office3d-label.compact { font-size: 10px; padding: 0 4px; border-radius: 4px; }
/* 이름표가 함께 떠 있으면 그 위로 — 간격을 3D 거리로 잡으면 확대 배율에 따라 겹친다. */
.office3d-bubble.raised { margin-top: -${BUBBLE_RAISE_PX}px; }
.office3d-bubble {
  font: 500 12px/1.35 "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
  max-width: 220px; white-space: normal; text-align: center;
  padding: 4px 9px; border-radius: 9px; background: #fffdf8; color: #33271f;
  border: 1.5px solid #33271f; box-shadow: 0 2px 0 rgba(51, 39, 31, 0.25);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
/* 접수 대기 점 — 글자는 그대로 두고 가림막만 옮긴다(글자를 바꾸려면 3D 장면까지 다시 그려야 한다).
   흰 점만 띄우면 밝은 바닥에서 안 보여 이름표와 같은 어두운 판 위에 올린다. */
.office3d-dots {
  position: relative; width: 36px; height: 16px; margin-top: -${DOTS_RAISE_PX}px; border-radius: 8px;
  background: rgba(38, 30, 25, 0.82); border: 1px solid rgba(255, 255, 255, 0.12);
}
.office3d-dots::after {
  content: "•••"; position: absolute; inset: 0; text-align: center; color: #fbf6ee;
  font: 700 15px/16px "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; letter-spacing: 2px; text-indent: 2px;
  animation: office3d-dots 0.96s step-end infinite;
}
@keyframes office3d-dots {
  0% { clip-path: inset(0 66% 0 0); }
  33% { clip-path: inset(0 33% 0 0); }
  66% { clip-path: inset(0 0 0 0); }
}
@media (prefers-reduced-motion: reduce) { .office3d-dots::after { animation: none; } }
.office3d-plate {
  font: 700 13px/1.3 "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
  padding: 3px 10px; border-radius: 8px; background: rgba(255, 253, 248, 0.88);
  border: 2px solid currentColor; white-space: nowrap;
}
.office3d-plate.common { color: #7d7166; border-width: 1.5px; font-size: 12px; }
.office3d-session { font: 600 11px/1.2 "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
  color: #8a7f75; text-shadow: 0 0 3px #fffdf8, 0 0 3px #fffdf8; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.office3d-session.active { color: #1f6f8b; }
.office3d-alarm { font-size: 20px; animation: office3d-pulse 0.8s ease-in-out infinite alternate; }
@keyframes office3d-pulse { from { transform: scale(0.85); opacity: 0.6; } to { transform: scale(1.15); opacity: 1; } }
.office3d-hud {
  position: absolute; left: 12px; top: 10px;
  font: 600 13px/1.3 "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
  padding: 6px 11px; border-radius: 8px; background: rgba(38, 30, 25, 0.82); color: #fbf6ee;
}
`;

export class Overlay3D {
  constructor() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = STYLE;
      document.head.appendChild(style);
    }
    this.css = new CSS2DRenderer();
    this.root = this.css.domElement;
    this.root.className = "office3d-overlay";
    this.hud = document.createElement("div");
    this.hud.className = "office3d-hud";
    this.hud.hidden = true;
    this.root.appendChild(this.hud);
    document.body.appendChild(this.root);
  }

  /** 겹침층을 캔버스 위에 정확히 포갠다. 캔버스가 flex 가운데 정렬이라 위치가 창마다 바뀐다. */
  place(canvas) {
    const rect = canvas.getBoundingClientRect();
    this.root.style.left = `${rect.left + window.scrollX}px`;
    this.root.style.top = `${rect.top + window.scrollY}px`;
    this.css.setSize(rect.width, rect.height);
  }

  /** 글자 한 조각. 반환값을 3D 물체에 붙이면 그 물체를 따라다닌다. */
  label(className, text = "") {
    const element = document.createElement("div");
    element.className = className;
    element.textContent = text;
    return new CSS2DObject(element);
  }

  /** 글자·모양이 바뀐 경우에만 DOM 을 건드린다 — 매 프레임 대입하면 레이아웃이 계속 다시 돈다. */
  static set(object, text, className) {
    const element = object.element;
    if (element.textContent !== text) {
      element.textContent = text;
    }
    if (className !== undefined && element.className !== className) {
      element.className = className;
    }
  }

  setHud(text) {
    this.hud.hidden = !text;
    if (this.hud.textContent !== text) {
      this.hud.textContent = text ?? "";
    }
  }

  render(scene, camera) {
    this.css.render(scene, camera);
  }

  /**
   * 장면을 통째로 갈아 끼울 때 옛 글자를 DOM 에서 걷어 낸다. CSS2DObject 는 장면에서 떼어질
   * 때만 스스로 지워지는데, 장면 자체를 버리면 그 사건이 오지 않아 글자가 화면에 남는다.
   */
  clear(scene) {
    scene?.traverse((node) => {
      if (node.isCSS2DObject) {
        node.element.remove();
      }
    });
  }
}
