type Vec2 = { x: number; y: number };

interface Entity { x: number; y: number; r: number; vx: number; vy: number; color: string }
interface Player extends Entity { speed: number; hits: number; boostTicks: number }
interface Opponent extends Entity { speed: number; hits: number; fireCooldown: number }
interface Projectile extends Entity { owner: 'player'|'cpu' }
interface PowerUp extends Entity { kind: 'sauce'; alive: boolean }

enum State { Playing, Won, Lost, TimeUp }

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const scoreEl = document.getElementById('score')!;
const enemyEl = document.getElementById('enemy')!;
const roundEl = document.getElementById('round')!;
const restartBtn = document.getElementById('restart') as HTMLButtonElement;
const timerEl = document.getElementById('timer')!;

let state: State = State.Playing;
let W = 0, H = 0, DPR = Math.max(1, Math.min(2, devicePixelRatio || 1));
let keys = new Set<string>();
let round = 1;
const hitsToClear = ()=> Math.min(15, 7 + Math.floor((round-1)/2));

const rand = (a:number,b:number)=>Math.random()*(b-a)+a;
const clamp = (v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v));
const len = (v:Vec2)=>Math.hypot(v.x,v.y);
const norm = (v:Vec2)=>{ const l=len(v)||1; return {x:v.x/l,y:v.y/l} };
const dist2 = (a:Entity,b:Entity)=>{const dx=a.x-b.x, dy=a.y-b.y; return dx*dx+dy*dy};

let player: Player; let cpu: Opponent;
let projs: Projectile[] = []; let powerUps: PowerUp[] = [];
let popups: {x:number;y:number;text:string;t:number}[] = [];
let spawnTimer = 0;
let roundBannerTicks = 0; let roundBannerText = '';
let obstacles: Entity[] = [];
let timerMsRemaining = 60000; // 60 seconds
let lastTickMs = performance.now();

// Touch input (virtual stick)
let touchId: number | null = null; let touchStart: Vec2 | null = null; let touchDir: Vec2 = {x:0,y:0}; let touchStartTime=0;

function resize() {
  W = Math.floor(innerWidth * DPR);
  H = Math.floor(innerHeight * DPR);
  canvas.width = W; canvas.height = H;
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = innerHeight + 'px';
}

function reset(keepRound=false) {
  if (!keepRound) round = 1;
  state = State.Playing;
  const cpuSpeed = (2.0 + 0.3*(round-1)) * DPR;
  const cpuFire = Math.max(30, 90 - 6*(round-1));
  const playerSpeed = (3.0 + 0.12*(round-1) + 0.06*Math.max(0, round-10)) * DPR;
  player = { x: W*0.25, y: H*0.5, r: 16*DPR, vx:0, vy:0, color:'#2c7', speed: playerSpeed, hits:0, boostTicks:0 };
  cpu    = { x: W*0.75, y: H*0.5, r: 16*DPR, vx:0, vy:0, color:'#c33', speed: cpuSpeed, hits:0, fireCooldown: cpuFire };
  projs.length = 0; powerUps.length = 0; popups.length = 0; obstacles.length = 0;
  generateObstacles();
  spawnTimer = Math.max(120, 240 + Math.floor(Math.random()*180) - 10*(round-1));
  timerMsRemaining = 60000; lastTickMs = performance.now();
  updateHud();
  restartBtn.style.display = 'none';
}

function updateHud(){
  const need = hitsToClear();
  scoreEl.textContent = `You: ${player.hits}/${need}`;
  enemyEl.textContent = `CPU: ${cpu.hits}/${need}`;
  roundEl.textContent = `Round: ${round}`;
  const sec = Math.max(0, Math.ceil(timerMsRemaining/1000));
  const mm = Math.floor(sec/60).toString().padStart(2,'0');
  const ss = (sec%60).toString().padStart(2,'0');
  timerEl.textContent = `${mm}:${ss}`;
}

function fire(from: Entity, owner: 'player'|'cpu', target: Vec2){
  const dir = norm({x: target.x - from.x, y: target.y - from.y});
  const speed = 5.0*DPR;
  projs.push({ x: from.x + dir.x*(from.r+6), y: from.y + dir.y*(from.r+6), r: 8*DPR, vx: dir.x*speed, vy: dir.y*speed, color: owner==='player'? '#e33':'#333', owner});
}

function spawnPower(){
  const m = 24*DPR;
  powerUps.push({ x: rand(m, W-m), y: rand(m, H-m), r: 12*DPR, vx:0, vy:0, color:'#f90', kind:'sauce', alive:true });
}

function addPopup(x:number,y:number,text:string){
  popups.push({x,y,text,t:90});
}

function handleInput(){
  // Keyboard
  const kUp = keys.has('ArrowUp')||keys.has('KeyW');
  const kDown = keys.has('ArrowDown')||keys.has('KeyS');
  const kLeft = keys.has('ArrowLeft')||keys.has('KeyA');
  const kRight = keys.has('ArrowRight')||keys.has('KeyD');
  let dir: Vec2 = {x:0,y:0};
  if (kUp) dir.y -= 1; if (kDown) dir.y += 1; if (kLeft) dir.x -= 1; if (kRight) dir.x += 1;
  if (touchId !== null && (touchDir.x!==0 || touchDir.y!==0)) dir = { ...dir, ...norm(touchDir) };
  if (dir.x!==0 || dir.y!==0) {
    const base = player.speed + (player.boostTicks>0? 1.5*DPR:0);
    const d = norm(dir); player.vx = d.x*base; player.vy = d.y*base;
  } else { player.vx *= 0.85; player.vy *= 0.85; }
}

function updatePlayer(){
  player.x = clamp(player.x + player.vx, player.r, W - player.r);
  player.y = clamp(player.y + player.vy, player.r, H - player.r);
  if (player.boostTicks>0) player.boostTicks--;
  resolveEntityObstacles(player);
}

function updateCPU(){
  // Simple chase
  const toP = norm({x: player.x - cpu.x, y: player.y - cpu.y});
  cpu.vx = toP.x * cpu.speed; cpu.vy = toP.y * cpu.speed;
  cpu.x = clamp(cpu.x + cpu.vx, cpu.r, W - cpu.r);
  cpu.y = clamp(cpu.y + cpu.vy, cpu.r, H - cpu.r);
  resolveEntityObstacles(cpu);
  cpu.fireCooldown--;
  if (cpu.fireCooldown<=0) {
    fire(cpu, 'cpu', {x: player.x, y: player.y});
    const base = Math.max(20, 90 - 6*(round-1));
    cpu.fireCooldown = Math.max(15, base + Math.floor(Math.random()*30));
  }
}

function updateProjectiles(){
  for (let i=projs.length-1;i>=0;i--){
    const p=projs[i]; p.x+=p.vx; p.y+=p.vy;
    if (p.x<-50||p.x>W+50||p.y<-50||p.y>H+50){ projs.splice(i,1); continue; }
    // Projectile vs obstacles
    let hitObstacle = false;
    for (const ob of obstacles){ if (dist2(p, ob) < (p.r+ob.r)*(p.r+ob.r)) { hitObstacle = true; break; } }
    if (hitObstacle){ projs.splice(i,1); continue; }
    if (p.owner==='player' && dist2(p,cpu) < (p.r+cpu.r)*(p.r+cpu.r)){
      projs.splice(i,1); cpu.hits++; updateHud();
      if (cpu.hits>=hitsToClear()){
        round++;
        // Soft transition: keep gameplay running, just scale difficulty and reset counters
        player.hits = 0; cpu.hits = 0; updateHud();
        // Increase difficulty for CPU
        cpu.speed = (2.0 + 0.3*(round-1)) * DPR;
        const base = Math.max(20, 90 - 6*(round-1));
        // Immediate action to avoid lull
        fire(cpu, 'cpu', {x: player.x, y: player.y});
        cpu.fireCooldown = Math.max(8, Math.min(20, base - 30));
        // Ensure next power-up comes soon
        spawnTimer = Math.min(spawnTimer, 60);
        player.speed = (3.0 + 0.12*(round-1) + 0.06*Math.max(0, round-10)) * DPR;
        // Regenerate obstacles for new round
        obstacles.length = 0; generateObstacles();
        // Show banner marker for next board
        roundBannerText = `Round ${round}`;
        roundBannerTicks = 120;
      }
    } else if (p.owner==='cpu' && dist2(p,player) < (p.r+player.r)*(p.r+player.r)){
      projs.splice(i,1); player.hits++; updateHud();
      if (player.hits>=hitsToClear()){ state=State.Lost; restartBtn.style.display='inline-block'; }
    }
  }
}

function updatePowerUps(){
  spawnTimer--; if (spawnTimer<=0){ spawnPower(); spawnTimer = Math.max(120, 240 + Math.floor(Math.random()*180) - 10*(round-1)); }
  for (const pu of powerUps){ if (!pu.alive) continue; if (dist2(pu, player) < (pu.r+player.r)*(pu.r+player.r)) { pu.alive=false; player.boostTicks = Math.max(player.boostTicks, 360); } }
}

function drawBackground(){
  // Subtle star-spangled vibe
  ctx.fillStyle = '#e8f0ff'; ctx.fillRect(0,0,W,H);
  ctx.save();
  const stripeH = H/10; ctx.globalAlpha = 0.15;
  for (let i=0;i<10;i++) { ctx.fillStyle = i%2? '#c00' : '#fff'; ctx.fillRect(0,i*stripeH,W,stripeH); }
  // stars
  ctx.globalAlpha = 0.12; ctx.fillStyle = '#035';
  for (let y=0;y<H;y+=80*DPR){ for (let x=0;x<W;x+=100*DPR){ ctx.beginPath(); ctx.arc(x+20*DPR,(y+20*DPR),3*DPR,0,Math.PI*2); ctx.fill(); }}
  ctx.restore();
  // Fence
  ctx.strokeStyle = '#964B00'; ctx.lineWidth = 4*DPR; ctx.strokeRect(12*DPR,12*DPR,W-24*DPR,H-24*DPR);
}

function drawEntity(e:Entity){ ctx.fillStyle=e.color; ctx.beginPath(); ctx.arc(e.x,e.y,e.r,0,Math.PI*2); ctx.fill(); }

function draw(){
  drawBackground();
  // Power-ups
  for (const pu of powerUps){ if (!pu.alive) continue; ctx.fillStyle = '#f90'; ctx.beginPath(); ctx.arc(pu.x,pu.y,pu.r,0,Math.PI*2); ctx.fill(); }
  // Projectiles as red/gray circles
  for (const p of projs){ drawEntity(p); }
  // Obstacles as squares (visual)
  for (const ob of obstacles){
    ctx.fillStyle = '#666';
    const size = ob.r * 2;
    ctx.fillRect(ob.x - ob.r, ob.y - ob.r, size, size);
  }
  // Player and CPU
  drawEntity(player);
  drawEntity(cpu);
  // Round transition banner (non-blocking)
  if (roundBannerTicks>0){
    const alpha = Math.min(1, roundBannerTicks/60);
    ctx.save();
    ctx.globalAlpha = 0.85*alpha;
    const pad = 10*DPR;
    ctx.fillStyle = '#022';
    ctx.textAlign = 'center';
    ctx.font = `${24*DPR}px sans-serif`;
    const text = roundBannerText || `Round ${round}`;
    // background pill
    const metrics = ctx.measureText(text);
    const tw = metrics.width + pad*2;
    const th = 34*DPR;
    const bx = (W - tw)/2, by = 20*DPR;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(bx, by, tw, th);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, W/2, by + th*0.68);
    ctx.restore();
  }
  // Popups
  for (const pop of popups){
    pop.t--; if (pop.t<0) continue; const alpha = Math.max(0, pop.t/90);
    ctx.globalAlpha = alpha; ctx.fillStyle = '#022'; ctx.font = `${16*DPR}px sans-serif`; ctx.fillText(pop.text, pop.x+10*DPR, pop.y-10*DPR - (90-pop.t)*0.2);
    ctx.globalAlpha = 1;
  }
  // On-screen hint
  if (state!==State.Playing){
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0,0,W,H);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.font = `${28*DPR}px sans-serif`;
    const title = state===State.Won? 'You Win the Backyard BBQ!' : state===State.Lost? 'CPU Served You!' : "Time's Up!";
    ctx.fillText(title, W/2, H/2 - 30*DPR);
    if (state===State.TimeUp){
      ctx.font = `${18*DPR}px sans-serif`;
      const need = hitsToClear();
      ctx.fillText(`Final Score — You: ${player.hits}/${need}  |  CPU: ${cpu.hits}/${need}`, W/2, H/2 + 0*DPR);
    }
    ctx.font = `${18*DPR}px sans-serif`;
    ctx.fillText('Tap or click Restart', W/2, H/2 + 10*DPR);
  }
}

function tick(){
  const now = performance.now();
  const dt = now - lastTickMs; lastTickMs = now;
  handleInput();
  if (state===State.Playing){
    // Timer countdown
    timerMsRemaining -= dt;
    if (timerMsRemaining <= 0){
      timerMsRemaining = 0; updateHud(); state = State.TimeUp; restartBtn.style.display='inline-block';
    }
    updatePlayer(); updateCPU();
    // Ensure player and CPU never overlap (high rounds)
    separateEntities(player, cpu);
    updateProjectiles(); updatePowerUps();
    // trim old popups
    popups = popups.filter(p=>p.t>0);
  }
  draw();
  if (state===State.Playing) updateHud();
  if (roundBannerTicks>0) roundBannerTicks--;
  requestAnimationFrame(tick);
}

// Input events
addEventListener('keydown', (e)=>{ keys.add(e.code); if (e.code==='Space' && state===State.Playing) fire(player,'player',{x:cpu.x,y:cpu.y}); });
addEventListener('keyup',   (e)=>{ keys.delete(e.code); });
canvas.addEventListener('mousedown',(e)=>{ if (state!==State.Playing) return; fire(player,'player',{x:cpu.x,y:cpu.y}); });

canvas.addEventListener('touchstart', (ev)=>{
  if (ev.changedTouches.length===0) return; const t=ev.changedTouches[0]; touchId=t.identifier; touchStart={x:t.clientX*DPR,y:t.clientY*DPR}; touchStartTime=performance.now(); touchDir={x:0,y:0};
},{passive:true});
canvas.addEventListener('touchmove', (ev)=>{
  if (touchId===null) return; for (const t of Array.from(ev.changedTouches)){ if (t.identifier===touchId){ const cur={x:t.clientX*DPR,y:t.clientY*DPR}; touchDir={x:cur.x-(touchStart!.x), y:cur.y-(touchStart!.y)}; break; } }
},{passive:true});
canvas.addEventListener('touchend', (ev)=>{
  for (const t of Array.from(ev.changedTouches)){
    if (t.identifier===touchId){
      const elapsed = performance.now()-touchStartTime; const dx = Math.abs(t.clientX*DPR-(touchStart!.x)); const dy = Math.abs(t.clientY*DPR-(touchStart!.y));
      if (elapsed<200 && dx<10*DPR && dy<10*DPR && state===State.Playing){ fire(player,'player',{x:cpu.x,y:cpu.y}); }
      touchId=null; touchStart=null; touchDir={x:0,y:0};
    }
  }
},{passive:true});

restartBtn.addEventListener('click', ()=> reset());

addEventListener('resize', ()=>{ resize(); reset(true); });

// Boot
resize();
reset();
requestAnimationFrame(tick);

// --- Obstacles helpers ---
function separateEntities(a: Entity, b: Entity){
  const dx = a.x - b.x, dy = a.y - b.y; const d = Math.hypot(dx,dy);
  const minD = a.r + b.r;
  if (d === 0){
    // Arbitrary small nudge apart if perfectly overlapped
    const n = 0.5*DPR; a.x += n; b.x -= n; return;
  }
  if (d < minD){
    const overlap = (minD - d) + 0.5*DPR;
    const nx = dx / d, ny = dy / d;
    // Split the push between both entities
    const pushA = overlap * 0.5; const pushB = overlap * 0.5;
    a.x = clamp(a.x + nx*pushA, a.r, W - a.r);
    a.y = clamp(a.y + ny*pushA, a.r, H - a.r);
    b.x = clamp(b.x - nx*pushB, b.r, W - b.r);
    b.y = clamp(b.y - ny*pushB, b.r, H - b.r);
  }
}
function generateObstacles(){
  const count = Math.min(12, 2 + Math.floor((round-1)/2));
  const margin = 36*DPR;
  const radii = [14,16,18,20].map(n=>n*DPR);
  let tries = 0;
  while (obstacles.length < count && tries < 500){
    tries++;
    const r = radii[Math.floor(Math.random()*radii.length)];
    const x = rand(margin, W - margin);
    const y = rand(margin, H - margin);
    const candidate: Entity = { x, y, r, vx:0, vy:0, color:'#666' } as Entity;
    // Avoid overlapping players, cpu, and other obstacles
    if (dist2(candidate, player) < (candidate.r + player.r + 40*DPR)**2) continue;
    if (dist2(candidate, cpu)    < (candidate.r + cpu.r    + 40*DPR)**2) continue;
    let ok = true;
    for (const o of obstacles){ if (dist2(candidate, o) < (candidate.r + o.r + 20*DPR)**2) { ok = false; break; } }
    if (!ok) continue;
    obstacles.push(candidate);
  }
}

function resolveEntityObstacles(e: Entity){
  for (const ob of obstacles){
    const dx = e.x - ob.x, dy = e.y - ob.y; const d = Math.hypot(dx,dy) || 1;
    const minD = e.r + ob.r;
    if (d < minD){
      const nx = dx / d, ny = dy / d; const push = (minD - d) + 0.5*DPR;
      e.x = clamp(e.x + nx*push, e.r, W - e.r);
      e.y = clamp(e.y + ny*push, e.r, H - e.r);
    }
  }
}
