type Vec2 = { x: number; y: number };

interface Entity { x: number; y: number; r: number; vx: number; vy: number; color: string }
interface Player extends Entity { speed: number; hits: number; boostTicks: number }
interface Opponent extends Entity { speed: number; hits: number; fireCooldown: number }
interface Projectile extends Entity { owner: 'player'|'cpu' }
interface PowerUp extends Entity { kind: 'sauce'; alive: boolean }

enum State { Playing, Won, Lost }

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const scoreEl = document.getElementById('score')!;
const enemyEl = document.getElementById('enemy')!;
const restartBtn = document.getElementById('restart') as HTMLButtonElement;

let state: State = State.Playing;
let W = 0, H = 0, DPR = Math.max(1, Math.min(2, devicePixelRatio || 1));
let keys = new Set<string>();

const rand = (a:number,b:number)=>Math.random()*(b-a)+a;
const clamp = (v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v));
const len = (v:Vec2)=>Math.hypot(v.x,v.y);
const norm = (v:Vec2)=>{ const l=len(v)||1; return {x:v.x/l,y:v.y/l} };
const dist2 = (a:Entity,b:Entity)=>{const dx=a.x-b.x, dy=a.y-b.y; return dx*dx+dy*dy};

let player: Player; let cpu: Opponent;
let projs: Projectile[] = []; let powerUps: PowerUp[] = [];
let popups: {x:number;y:number;text:string;t:number}[] = [];
let spawnTimer = 0;

// Touch input (virtual stick)
let touchId: number | null = null; let touchStart: Vec2 | null = null; let touchDir: Vec2 = {x:0,y:0}; let touchStartTime=0;

function resize() {
  W = Math.floor(innerWidth * DPR);
  H = Math.floor(innerHeight * DPR);
  canvas.width = W; canvas.height = H;
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = innerHeight + 'px';
}

function reset() {
  state = State.Playing;
  player = { x: W*0.25, y: H*0.5, r: 16*DPR, vx:0, vy:0, color:'#2c7', speed: 2.2*DPR, hits:0, boostTicks:0 };
  cpu    = { x: W*0.75, y: H*0.5, r: 16*DPR, vx:0, vy:0, color:'#c33', speed: 2.0*DPR, hits:0, fireCooldown: 90 };
  projs.length = 0; powerUps.length = 0; popups.length = 0;
  spawnTimer = 180; // power-up every ~3s at 60fps
  updateHud();
  restartBtn.style.display = 'none';
}

function updateHud(){
  scoreEl.textContent = `You: ${player.hits}`;
  enemyEl.textContent = `CPU: ${cpu.hits}`;
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
}

function updateCPU(){
  // Simple chase
  const toP = norm({x: player.x - cpu.x, y: player.y - cpu.y});
  cpu.vx = toP.x * cpu.speed; cpu.vy = toP.y * cpu.speed;
  cpu.x = clamp(cpu.x + cpu.vx, cpu.r, W - cpu.r);
  cpu.y = clamp(cpu.y + cpu.vy, cpu.r, H - cpu.r);
  cpu.fireCooldown--;
  if (cpu.fireCooldown<=0) {
    fire(cpu, 'cpu', {x: player.x, y: player.y});
    cpu.fireCooldown = 60 + Math.floor(Math.random()*60);
  }
}

function updateProjectiles(){
  for (let i=projs.length-1;i>=0;i--){
    const p=projs[i]; p.x+=p.vx; p.y+=p.vy;
    if (p.x<-50||p.x>W+50||p.y<-50||p.y>H+50){ projs.splice(i,1); continue; }
    if (p.owner==='player' && dist2(p,cpu) < (p.r+cpu.r)*(p.r+cpu.r)){
      projs.splice(i,1); cpu.hits++; updateHud(); addPopup(cpu.x,cpu.y, Math.random()<0.5? 'Ouch, that\'s well-done!':'Taste the grill!');
      if (cpu.hits>=5){ state=State.Won; restartBtn.style.display='inline-block'; }
    } else if (p.owner==='cpu' && dist2(p,player) < (p.r+player.r)*(p.r+player.r)){
      projs.splice(i,1); player.hits++; updateHud(); addPopup(player.x,player.y, Math.random()<0.5? 'Spicy hit!':'Charred!');
      if (player.hits>=5){ state=State.Lost; restartBtn.style.display='inline-block'; }
    }
  }
}

function updatePowerUps(){
  spawnTimer--; if (spawnTimer<=0){ spawnPower(); spawnTimer = 240 + Math.floor(Math.random()*180); }
  for (const pu of powerUps){ if (!pu.alive) continue; if (dist2(pu, player) < (pu.r+player.r)*(pu.r+player.r)) { pu.alive=false; player.boostTicks = Math.max(player.boostTicks, 360); addPopup(player.x, player.y, 'Secret Sauce!'); } }
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
  // Player and CPU
  drawEntity(player);
  drawEntity(cpu);
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
    ctx.fillText(state===State.Won? 'You Win the Backyard BBQ!' : 'CPU Served You!', W/2, H/2 - 20*DPR);
    ctx.font = `${18*DPR}px sans-serif`;
    ctx.fillText('Tap or click Restart', W/2, H/2 + 10*DPR);
  }
}

function tick(){
  handleInput();
  if (state===State.Playing){
    updatePlayer(); updateCPU(); updateProjectiles(); updatePowerUps();
    // trim old popups
    popups = popups.filter(p=>p.t>0);
  }
  draw();
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

addEventListener('resize', ()=>{ resize(); reset(); });

// Boot
resize();
reset();
requestAnimationFrame(tick);
