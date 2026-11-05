// 스킬쟁이 릴스 렌더러: 타임라인 JSON 한 개를 1080x1920 mp4 로 그린다.
// 사용: node hermes-skill-reels-render.cjs <timeline.json> <출력 mp4>
// 캐릭터 점프 동작(발 바닥 고정, 엉덩이 선 y=848 기준 몸 변형, 웅크림 → 공중 발 오므림 → 착지 반동)은
// ~/Desktop/skill-jaengyi-character/tools/render-parts.cjs 에서 사용자가 확정한 것을 그대로 옮겼다. 바꾸지 않는다.
// 말하는 동안에는 손짓 포즈(point·wave·think) 위에 talk-* 의 입 부분만 합성해 손짓하며 말하게 한다
// (포즈 이미지들의 얼굴 위치가 같아 이음매가 보이지 않는다, 2026-11-04 확인).
// 입 모양은 프레임별 문자열(c/h/o), 끄덕임은 프레임별 음성 크기(0~9)를 따른다.
// 프레임은 디스크에 쓰지 않고 PNG 를 ffmpeg stdin 으로 바로 흘린다.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// hermes 는 ~/.hermes/scripts 복사본을 실행하므로 레포 node_modules 의 puppeteer 를 절대경로로도 찾는다.
const REPO_PUPPETEER = path.join(process.env.HOME || '', 'Desktop/backend/기타/personal_agents/node_modules/puppeteer');
const puppeteer = (() => {
  try {
    return require('puppeteer');
  } catch {
    return require(REPO_PUPPETEER);
  }
})();

const W = 1080;
const H = 1920;
const NAMES = ['body-idle', 'body-wave', 'body-point', 'body-think', 'body-surprise', 'body-thumbsup', 'talk-closed', 'talk-half', 'talk-open', 'blink', 'foot-left', 'foot-right'];

// 자막·제목은 뉴스에서 온 텍스트로 만들어진다. </script> 가 섞여도 스크립트 태그를 닫지 못하게 < 와 줄 구분 문자를 이스케이프한다(PR #966 리뷰).
function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function html(timeline) {
  return `<!doctype html><body style="margin:0"><canvas id="c" width="${W}" height="${H}"></canvas><script>
  const W=${W}, H=${H}, T=${safeJson(timeline)}, imgs={}, talking={};
  const FONT='"Apple SD Gothic Neo", sans-serif';
  const MOUTH={c:'talk-closed', h:'talk-half', o:'talk-open'};

  // 손짓 포즈 + 입 합성본을 미리 만든다. 입 영역은 rig2 를 만들 때 쓴 타원(505,575 r85x70)과 같다.
  function withMouth(body, mouth){
    const out=document.createElement('canvas'); out.width=out.height=1024;
    const o=out.getContext('2d'); o.drawImage(body,0,0);
    const m=document.createElement('canvas'); m.width=m.height=1024;
    const g=m.getContext('2d'); g.drawImage(mouth,0,0);
    g.globalCompositeOperation='destination-in';
    g.setTransform(1,0,0,70/85,0,575*(1-70/85));
    const grad=g.createRadialGradient(505,575,0,505,575,85);
    grad.addColorStop(0,'rgba(0,0,0,1)'); grad.addColorStop(0.82,'rgba(0,0,0,1)'); grad.addColorStop(1,'rgba(0,0,0,0)');
    g.fillStyle=grad; g.fillRect(0,0,1024,1024);
    o.drawImage(m,0,0);
    return out;
  }
  window.load=async(d)=>{
    await Promise.all(Object.entries(d).map(([k,v])=>new Promise(r=>{const i=new Image(); i.onload=()=>{imgs[k]=i;r();}; i.src=v;})));
    for(const [mark,name] of Object.entries(MOUTH)){
      talking['body-idle'+mark]=imgs[name];
      for(const body of ['body-point','body-wave','body-think']) talking[body+mark]=withMouth(imgs[body], imgs[name]);
    }
  };

  // render-parts.cjs 와 같은 점프 단계: 웅크림(0~0.1) → 공중(0.1~0.42) → 착지 반동
  const PRE=0.10, AIR=0.32;
  function motion(dt, power){
    if(power<=0){ return {jump:0, tuck:0, squash:-0.06*Math.exp(-dt*9)*Math.cos(dt*22)}; }
    if(dt<PRE){ const k=Math.sin(dt/PRE*Math.PI/2); return {jump:0, tuck:0, squash:-0.11*k*Math.min(1,power)}; }
    if(dt<PRE+AIR){ const u=(dt-PRE)/AIR; const h=Math.sin(u*Math.PI);
      return {jump:power*85*h, tuck:16*power*h, squash:0.07*Math.cos(u*Math.PI)*Math.min(1,power)}; }
    const l=dt-PRE-AIR; return {jump:0, tuck:0, squash:-0.12*Math.min(1,power)*Math.exp(-l*10)*Math.cos(l*20)};
  }

  function greedy(c, text, maxWidth){
    const lines=[]; let line='';
    for(const word of text.split(' ')){
      const next=line?line+' '+word:word;
      if(c.measureText(next).width>maxWidth && line){ lines.push(line); line=word; } else { line=next; }
    }
    if(line) lines.push(line);
    return lines;
  }
  // 두 줄이면 가장 긴 줄이 가장 짧아지는 곳에서 끊는다("될까요?" 한 단어만 넘어가는 것 방지).
  function balanced(c, text, maxWidth){
    if(c.measureText(text).width<=maxWidth) return [text];
    const words=text.split(' '); let best=null;
    for(let i=1;i<words.length;i++){
      const a=words.slice(0,i).join(' '), b=words.slice(i).join(' ');
      const width=Math.max(c.measureText(a).width, c.measureText(b).width);
      if(width<=maxWidth && (!best || width<best.width)) best={lines:[a,b], width};
    }
    return best?best.lines:greedy(c,text,maxWidth);
  }
  function roundRect(c,x,y,w,h,r){ c.beginPath(); c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r); c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath(); }
  const ease=(u)=>1-Math.pow(1-Math.min(1,Math.max(0,u)),3);
  function shadow(c,on){ if(on){ c.shadowColor='rgba(138,74,16,0.12)'; c.shadowBlur=26; c.shadowOffsetY=6; } else { c.shadowColor='transparent'; } }

  // 상단 제목 카드 + 출처. 높이를 돌려줘 포인트 카드가 그 아래에서 시작하게 한다.
  function drawHeader(c){
    c.font='900 60px '+FONT; const lines=balanced(c,T.headline,920-96).slice(0,2);
    const x=80, y=230, w=920, h=118+lines.length*72+58;   // 맨 아래 줄은 대상 이름(검색해서 찾을 수 있게 영상 내내 보인다)
    c.save(); shadow(c,true); c.fillStyle='#FFFFFF'; roundRect(c,x,y,w,h,40); c.fill(); shadow(c,false);
    c.font='800 34px '+FONT; const badgeW=c.measureText(T.badge).width+48;
    c.fillStyle='#FB8826'; roundRect(c,x+44,y+34,badgeW,56,28); c.fill();
    c.fillStyle='#FFFFFF'; c.textBaseline='middle'; c.textAlign='left'; c.fillText(T.badge,x+68,y+63);
    c.font='600 28px '+FONT; c.fillStyle='#9A6B45'; c.textAlign='right'; c.fillText('출처: '+T.source, x+w-44, y+63);
    c.fillStyle='#3F2613'; c.font='900 60px '+FONT; c.textAlign='left'; c.textBaseline='alphabetic';
    lines.forEach((line,i)=>c.fillText(line,x+44,y+160+i*72));
    // 대상 이름은 위 날짜 배지와 같은 모양의 연한 배지로 카드 안에 둔다(맨 글자만 두면 카드 밖에 뜬 것처럼 보였다).
    c.font='800 32px '+FONT; const chipW=c.measureText(T.subject).width+44, chipY=y+160+(lines.length-1)*72+22;
    c.fillStyle='#FDE3C8'; roundRect(c,x+44,chipY,chipW,50,25); c.fill();
    c.fillStyle='#B85A12'; c.textBaseline='middle'; c.fillText(T.subject, x+66, chipY+26); c.textBaseline='alphabetic';
    c.restore();
    return y+h;
  }

  // 포인트 카드: 가장 최근 한 장만 보인다. 지난 숫자 카드가 새 자막과 함께 남아 있으면 무엇의 숫자인지 헷갈렸다
  // (2026-11-04 리뷰). number 는 숫자를 크게, summary 는 「한 줄 정리」로 강조.
  function drawPoints(c,t,top){
    const latest=T.points.filter(p=>p.start<=t).at(-1);
    const list=latest?[latest]:[];
    let y=top+36;
    list.forEach((p)=>{
      const u=ease((t-p.start)/0.25), dx=(1-u)*80;
      const index=T.points.indexOf(p)+1;
      c.save(); c.globalAlpha=u;
      if(p.kind==='summary'){
        c.font='900 54px '+FONT; const lines=balanced(c,p.text,920-96).slice(0,3);
        const h=112+lines.length*68;
        shadow(c,true); c.fillStyle='#FB8826'; roundRect(c,80+dx,y,920,h,36); c.fill(); shadow(c,false);
        c.fillStyle='#FFF4E6'; c.font='800 32px '+FONT; c.textAlign='left'; c.textBaseline='alphabetic'; c.fillText('한 줄 정리',124+dx,y+62);
        c.fillStyle='#FFFFFF'; c.font='900 54px '+FONT; lines.forEach((line,i)=>c.fillText(line,124+dx,y+136+i*68));
        y+=h+20;
      } else {
        const big=p.kind==='number';
        c.font=(big?'900 64px ':'800 44px ')+FONT; const lines=balanced(c,p.text,920-170).slice(0,2);
        const lineH=big?76:56, h=56+lines.length*lineH;
        shadow(c,true); c.fillStyle='#FFFFFF'; roundRect(c,80+dx,y,920,h,30); c.fill(); shadow(c,false);
        c.fillStyle='#FDE3C8'; c.beginPath(); c.arc(80+dx+62,y+h/2,30,0,Math.PI*2); c.fill();
        c.fillStyle='#E06E10'; c.font='900 34px '+FONT; c.textAlign='center'; c.textBaseline='middle'; c.fillText(String(index),80+dx+62,y+h/2+2);
        c.fillStyle=big?'#E06E10':'#3F2613'; c.font=(big?'900 64px ':'800 44px ')+FONT; c.textAlign='left'; c.textBaseline='middle';
        lines.forEach((line,i)=>c.fillText(line,80+dx+118,y+28+lineH/2+i*lineH));
        y+=h+18;
      }
      c.restore();
    });
  }

  function drawSubtitle(c,t){
    const sub=T.subtitles.find(s=>s.start<=t && t<s.end);
    if(!sub) return;
    c.font='900 60px '+FONT; c.textAlign='center'; c.textBaseline='alphabetic';
    const lines=balanced(c,sub.text,940).slice(0,3);
    const top=1020-(lines.length-1)*38;
    lines.forEach((line,i)=>{
      const y=top+i*76;
      c.lineJoin='round'; c.lineWidth=14; c.strokeStyle='#FFFFFF'; c.strokeText(line,W/2,y);
      c.fillStyle='#3F2613'; c.fillText(line,W/2,y);
    });
  }

  const level=(f)=>{ let sum=0, n=0; for(let i=f-2;i<=f+2;i++){ if(T.energy[i]!==undefined){ sum+=+T.energy[i]; n++; } } return n?sum/n/9:0; };

  window.draw=(f)=>{
    const t=f/T.fps;
    const c=document.getElementById('c').getContext('2d');
    c.fillStyle='#FDF5E7'; c.fillRect(0,0,W,H);
    drawPoints(c,t,drawHeader(c));

    let cur=T.events[0]; for(const e of T.events){ if(e.start<=t) cur=e; }
    const dt=Math.max(0,t-cur.start);
    const react=!cur.talk && t<cur.end;
    const m=react?motion(dt,cur.power):(cur.bounce?motion(dt,0):{jump:0,tuck:0,squash:0});
    const breath=Math.sin(t*2*Math.PI*0.9)*0.012;
    const nod=level(f)*0.022;                          // 말소리가 클수록 살짝 눌렸다 펴진다(끄덕임)
    const sy=1+m.squash+breath-nod, sx=1-(m.squash+breath-nod)*0.6;
    const sway=cur.talk?Math.sin(t*2*Math.PI*0.45)*1.4:0;
    const tilt=((react||cur.talk?cur.tilt*Math.min(1,dt/0.25):0)+sway)*Math.PI/180;
    const mark=T.mouth[f]||'c';
    let image;
    if(react) image=imgs[cur.body];
    else if(cur.talk) image=talking[cur.body+mark];   // 문장 사이 짧은 쉼에도 손짓을 유지해 팔이 깜빡이지 않게 한다
    else image=talking['body-idle'+mark];
    if(!react && (!cur.talk || cur.body==='body-idle') && T.blinks.some(b=>t>=b && t<b+0.1)) image=imgs['blink'];

    const k=0.68, cx=W/2, ground=1650;                 // 이미지 좌표 (512,905)=발바닥 중앙
    const HIP=848;                                      // 몸 변형 기준선(이미지 y)
    const lift=m.jump*k;
    const sh=1-m.jump/170;
    c.save(); c.globalAlpha=0.18*sh; c.fillStyle='#8a4a10'; c.beginPath();
    c.ellipse(cx,ground+6,170*k*sh,22*k*sh,0,0,Math.PI*2); c.fill(); c.restore();
    const drawFoot=(name,dir)=>{ c.save();
      c.translate(cx+dir*m.tuck*0.35*k, ground-lift-m.tuck*k); c.scale(k,k); c.drawImage(imgs[name],-512,-905); c.restore(); };
    drawFoot('foot-left',1); drawFoot('foot-right',-1);
    c.save(); c.translate(cx, ground-lift-(905-HIP)*k); c.rotate(tilt); c.scale(sx*k, sy*k);
    c.drawImage(image,-512,-HIP); c.restore();
    drawSubtitle(c,t);  // 점프한 새싹이 자막을 가리지 않게 맨 마지막에 그린다
  };</script>`;
}

(async () => {
  const [timelinePath, outFile] = process.argv.slice(2);
  const timeline = JSON.parse(fs.readFileSync(timelinePath, 'utf8'));
  const total = timeline.mouth.length;
  const ffmpeg = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(timeline.fps), '-c:v', 'png', '-i', '-',
    '-i', timeline.audio, '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k',
    '-shortest', '-movflags', '+faststart', outFile], { stdio: ['pipe', 'inherit', 'inherit'] });
  const finished = new Promise((resolve, reject) => {
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
  });

  const browser = await puppeteer.launch({ headless: true, args: ['--hide-scrollbars'] });
  try {
    const tab = await browser.newPage();
    await tab.setViewport({ width: W, height: H });
    await tab.setContent(html(timeline));
    const data = Object.fromEntries(NAMES.map((n) => [n, 'data:image/png;base64,' + fs.readFileSync(path.join(timeline.rig, n + '.png')).toString('base64')]));
    await tab.evaluate((d) => window.load(d), data);
    const canvas = await tab.$('#c');
    for (let f = 0; f < total; f++) {
      await tab.evaluate((frame) => window.draw(frame), f);
      const png = await canvas.screenshot({ type: 'png' });
      if (!ffmpeg.stdin.write(png)) {
        await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
      }
    }
  } finally {
    await browser.close();
    ffmpeg.stdin.end();
  }
  await finished;
  console.log(`frames ${total} -> ${outFile}`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
