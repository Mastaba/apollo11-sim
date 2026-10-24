// SPDX-License-Identifier: GPL-2.0-or-later
// Part of the Apollo 11 simulator. Free software under the GNU GPL v2 or later; see the Licences section of the page.
(async function () {
  'use strict';
  const C = window.MissionCore, MB = window.MissionBuilder, EDU = window.EDU || {};
  const { T, R_E, R_M, W_E, add, sub, mul, dot, cross, norm, unit } = C;
  const P = { tli: [3.1727548981604534, 4.375390617609132, 0], inc: 32.896644093447755, brakeThr: 0.88, downrange: 16.789532187133574, tei: [1.0079524989435469, 10.456977331672345, 0] };
  const LAUNCH_UTC = Date.UTC(1969, 6, 16, 13, 32, 0);
  const $ = (id) => document.getElementById(id);
  const D2R = Math.PI / 180;

  async function unpack(b64) {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const out = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    return new Uint8Array(out);
  }

  // ---------------- mission ----------------
  await new Promise((r) => setTimeout(r, 30));
  const MIS = MB.build(P);
  const M = MIS.M, S = MIS.tracks.stack, L = MIS.tracks.lm, SV = MIS.tracks.sivb, NOTES = MIS.notes;
  const EV = MIS.ev;
  const evT = (name) => (EV.find((e) => e.name === name) || {}).t;
  const tTouch = evT('Touchdown'), tLift = evT('Lunar liftoff'), tSplash = evT('Splashdown'), tEI = evT('Entry interface');
  const tDrogue = evT('Drogue chutes'), tMain = evT('Main chutes'), tIns = evT('Earth orbit insertion');
  const tTliEnd = evT('TLI cutoff'), tTliIgn = evT('TLI ignition'), tLoi1 = evT('LOI-1'), tTei = evT('TEI');
  const tEnd = tSplash + 600, tStart = -12;
  const SITE = MIS.site, KSC = C.SITES.ksc;
  // Manned Spacecraft Center, Houston (now Johnson Space Center): Building 30, Mission Control
  const MSC = { lat: 29.55806, lon: -95.08833 }, DTN = { lat: 29.7580, lon: -95.3670 }, HOUCAP = { lat: 29.60, lon: -95.10 };
  const siteAt = (t) => M.selenoToECI(t, SITE.lat, SITE.lon, 0);
  const splashLL = M.latLonOf(tSplash, S.at(tSplash).p);

  // ---- derived milestones from the simulated trajectory
  const stackAt = (t) => S.at(t);
  {
    let mach = null, maxq = { q: 0, t: 0, alt: 0 };
    for (let t = 1; t < 200; t += 0.5) {
      const s = stackAt(t), alt = norm(s.p) - R_E, vrel = norm(sub(s.v, cross([0, 0, W_E], s.p))) * 1000;
      const q = 0.5 * 1.225 * Math.exp(-alt / 7.2) * vrel * vrel, a = alt < 11 ? 340.3 - 4.0 * alt : 295;
      if (!mach && vrel >= a) mach = t; if (q > maxq.q) maxq = { q, t, alt };
    }
    NOTES.maxq = maxq;
    if (mach) EV.push({ t: mach, name: 'Mach 1', desc: 'The Saturn V goes supersonic.', phase: 'launch' });
    EV.push({ t: maxq.t, name: 'Max Q', desc: 'Peak aerodynamic pressure on the vehicle.', phase: 'launch' });
    EV.push({ t: 197.9, name: 'Launch escape tower jettison', desc: 'The escape tower is jettisoned.', phase: 'launch' });
    for (let t = tTliEnd; t < tLoi1; t += 60) { if (norm(sub(stackAt(t).p, M.moonPos(t))) < 66100) { EV.push({ t, name: 'Entering the Moon\'s sphere of influence', desc: 'The Moon\'s gravity now dominates.', phase: 'translunar' }); NOTES.soiV = norm(stackAt(t).v); break; } }
    const occ = (t) => { const p = stackAt(t).p, m = M.moonPos(t), u = dot(m, p) / dot(p, p); return u > 0 && u < 1 && norm(sub(m, mul(p, u))) < R_M; };
    const scan = (a, b, nameL, nameA, phase) => {
      let prev = occ(a), los = null;
      for (let t = a; t < b; t += 5) { const o = occ(t); if (o && !prev && !los) { los = t; EV.push({ t, name: nameL, desc: 'Columbia passes behind the Moon.', phase }); } if (!o && prev && los) { EV.push({ t, name: nameA, desc: 'Columbia reappears from behind the Moon.', phase }); break; } prev = o; }
    };
    scan(tLoi1 - 3600, tLoi1 + 3600, 'Loss of signal', 'Acquisition of signal', 'loi');
    scan(tTei - 3600, tTei + 3600, 'Loss of signal (TEI)', 'Acquisition of signal (TEI)', 'transearth');
    for (let t = tEI; t < tEI + 600; t += 1) { const a = norm(sub(mul(sub(stackAt(t + 0.5).v, stackAt(t - 0.5).v), 1), M.grav(t, stackAt(t).p))) * 1000; if (a > 3) { EV.push({ t, name: 'Radio blackout', desc: 'Plasma around the heat shield cuts radio contact.', phase: 'entry' }); break; } }
    for (const [t, name, desc] of EVA.events) EV.push({ t, name, desc, phase: 'surface' });
    EV.sort((a, b) => a.t - b.t);
  }
  const D_SPLASH = (() => { const a = M.geoToECI(0, splashLL.lat, splashLL.lon), b = M.geoToECI(0, C.SITES.splash.lat, C.SITES.splash.lon); return Math.acos(Math.min(1, dot(unit(a), unit(b)))) * R_E; })();
  const fmtGET = (t) => { const s = Math.abs(t), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = Math.floor(s % 60); return (t < 0 ? '-' : '') + String(h).padStart(3, '0') + ':' + String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0'); };
  const shortGET = (t) => fmtGET(t).replace(/^0+(?=\d{1,}:)/, '');
  const SIMFACT = {
    'Max Q': () => `Simulated: ${(NOTES.maxq.q / 1000).toFixed(0)} kPa at T+${NOTES.maxq.t.toFixed(0)} s, ${NOTES.maxq.alt.toFixed(1)} km up`,
    'Earth orbit insertion': () => `Simulated: ${(NOTES.insertion.oscE.rp - R_E).toFixed(0)} × ${(NOTES.insertion.oscE.ra - R_E).toFixed(0)} km, inclination ${NOTES.insertion.inc.toFixed(2)}° (real 32.52°)`,
    'TLI ignition': () => `Simulated: after ${NOTES.revs.earth.toFixed(2)} Earth orbits (real: 1.5)`,
    'TLI cutoff': () => `Simulated: Δv ${(NOTES.tli.dv * 1000).toFixed(0)} m/s over ${((NOTES.tli.end - NOTES.tli.start) / 60).toFixed(1)} min, speed ${NOTES.tli.v.toFixed(2)} km/s`,
    'Entering the Moon\'s sphere of influence': () => `Simulated: speed relative to Earth here is only ${(NOTES.soiV * 1000).toFixed(0)} m/s`,
    'LOI-1': () => `Simulated: ${(NOTES.loi1.dv * 1000).toFixed(0)} m/s over ${(NOTES.loi1.dur / 60).toFixed(2)} min, giving a ${NOTES.loi1.orbit.rp.toFixed(0)} × ${NOTES.loi1.orbit.ra.toFixed(0)} km orbit`,
    'LOI-2': () => `Simulated: ${(NOTES.loi2.dv * 1000).toFixed(0)} m/s, orbit ${NOTES.loi2.orbit.rp.toFixed(0)} × ${NOTES.loi2.orbit.ra.toFixed(0)} km, inclined ${NOTES.lunarIncl.toFixed(1)}° to the lunar equator (retrograde)`,
    'DOI': () => `Simulated: ${(NOTES.doiBurn.dv * 1000).toFixed(1)} m/s`,
    'Touchdown': () => `Simulated: ${(NOTES.touchdown.dur / 60).toFixed(1)} min after PDI, ${(NOTES.touchdown.err * 1000).toFixed(0)} m from the site's coordinates, Eagle mass ${(NOTES.touchdown.mass / 1000).toFixed(1)} t`,
    'Ascent insertion': () => `Simulated: ${NOTES.ascent.rp.toFixed(0)} × ${NOTES.ascent.ra.toFixed(0)} km after ${(NOTES.ascent.dur / 60).toFixed(1)} min, ${NOTES.ascent.gap.toFixed(0)} km behind Columbia`,
    'TEI': () => `Simulated: ${(NOTES.tei.dv * 1000).toFixed(0)} m/s over ${(NOTES.tei.dur / 60).toFixed(1)} min, after ${Math.ceil(NOTES.revs.moon)} lunar orbits (real: 30)`,
    'Entry interface': () => `Simulated: ${NOTES.ei.v.toFixed(2)} km/s at ${NOTES.ei.fpa.toFixed(2)}°, peak ${NOTES.entry.maxG.toFixed(1)} g`,
    'Splashdown': () => `Simulated: ${Math.abs(splashLL.lat).toFixed(2)}° ${splashLL.lat >= 0 ? 'N' : 'S'}, ${Math.abs(splashLL.lon).toFixed(2)}° ${splashLL.lon >= 0 ? 'E' : 'W'}, ${D_SPLASH.toFixed(0)} km from the real splashdown point`,
  };


  // ---- revolution counting: angle swept around the central body, sampled along each track
  function revTable(track, t0, t1, center) {
    const ts = [], ang = []; let acc = 0, prev = null;
    for (let t = t0; t <= t1 + 1e-6; t += 20) {
      const s = track.at(t); if (!s) continue; const r = unit(sub(s.p, center(t)));
      if (prev) acc += Math.acos(Math.max(-1, Math.min(1, dot(prev, r))));
      prev = r; ts.push(t); ang.push(acc / (2 * Math.PI));
    }
    return { t0, t1, ts, ang, total: acc / (2 * Math.PI) };
  }
  const revAt = (tab, t) => { if (!tab || t < tab.t0 || t > tab.t1) return null; let lo = 0, hi = tab.ts.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tab.ts[m] <= t) lo = m; else hi = m; } const u = (t - tab.ts[lo]) / ((tab.ts[hi] - tab.ts[lo]) || 1); return tab.ang[lo] + (tab.ang[hi] - tab.ang[lo]) * u; };
  const REV = {
    earth: revTable(S, tIns, tTliIgn, () => [0, 0, 0]),
    moon: revTable(S, tLoi1, tTei, M.moonPos),
    lmDown: revTable(L, T.undock, tTouch, M.moonPos),
    lmUp: revTable(L, evT('Ascent insertion'), T.docking, M.moonPos),
  };
  NOTES.revs = { earth: REV.earth.total, moon: REV.moon.total };
  // Status line: what the followed vehicle is doing; the bar shows progress through the orbit or leg
  const evEnd = (name, fallback) => { const t = evT(name); return t != null ? t : fallback; };
  const tSOI = evEnd('Entering the Moon\'s sphere of influence', tLoi1 - 4 * 3600), tLoiEnd = tLoi1 + NOTES.loi1.dur, tTeiEnd = tTei + NOTES.tei.dur;
  const tDoi = evT('DOI'), tPdi = evT('PDI'), tAscIns = evEnd('Ascent insertion', tLift + 430);
  function orbitText(who, t) {
    const leg = (text, a, b) => ({ text, frac: Math.max(0, Math.min(1, (t - a) / (b - a))) });
    const rev = (name, tab, extra) => { const x = revAt(tab, t); return x == null ? null : { text: `${name} ${Math.floor(x) + 1} of ${Math.ceil(tab.total - 1e-3)}${extra || ''}`, frac: x - Math.floor(x) }; };
    if (who === 'lm') {
      if (t < tDoi) return rev('Eagle: lunar orbit', REV.lmDown, ' · just undocked') || leg('Eagle undocked', T.undock, tDoi);
      if (t < tDoi + NOTES.doiBurn.dur + 2) return leg('Lowering orbit (DOI burn)', tDoi, tDoi + NOTES.doiBurn.dur);
      if (t < tPdi) return leg('Falling toward 15 km perilune', tDoi, tPdi);
      if (t < tTouch) return leg('Landing (powered descent)', tPdi, tTouch);
      if (t < EVA.hatchOpen) return leg('On the surface · preparing to go outside', tTouch, EVA.hatchOpen);
      if (t < EVA.hatchClose) return leg('Moonwalk in progress', EVA.hatchOpen, EVA.hatchClose);
      if (t < tLift) return leg('On the surface · resting before liftoff', EVA.hatchClose, tLift);
      if (t < tAscIns) return leg('Climbing to orbit (ascent engine)', tLift, tAscIns);
      if (t < T.docking) return rev('Chasing Columbia · orbit', REV.lmUp) || leg('Chasing Columbia', tAscIns, T.docking);
    }
    if (t < 0) return { text: 'On the pad · countdown', frac: 0 };
    if (t < tIns) return leg('Climbing to orbit', 0, tIns);
    if (t < tTliIgn) return rev('Earth orbit', REV.earth) || leg('Earth parking orbit', tIns, tTliIgn);
    if (t < tTliEnd) return leg('Leaving Earth orbit (TLI burn)', tTliIgn, tTliEnd);
    if (t < tSOI) return leg('Headed to the Moon', tTliEnd, tSOI);
    if (t < tLoi1) return leg('Falling toward the Moon', tSOI, tLoi1);
    if (t < tLoiEnd) return leg('Braking into lunar orbit (LOI-1)', tLoi1, tLoiEnd);
    if (t < tTei) { const alone = t >= T.undock && t < T.docking ? ' · Collins alone' : ''; return rev('Lunar orbit', REV.moon, alone) || leg('Lunar orbit', tLoiEnd, tTei); }
    if (t < tTeiEnd) return leg('Leaving lunar orbit (TEI burn)', tTei, tTeiEnd);
    if (t < T.cmSep) return leg('Headed home to Earth', tTeiEnd, T.cmSep);
    if (t < tEI) return leg('Preparing for entry', T.cmSep, tEI);
    if (t < (tDrogue || tSplash)) return leg('Re-entering the atmosphere', tEI, tDrogue || tSplash);
    if (t < tSplash) return leg('Under parachutes', tDrogue, tSplash);
    return { text: 'Splashed down · awaiting recovery', frac: 1 };
  }

  // ---------------- AGCs ----------------
  const [wasm, ropeCM, ropeLM] = await Promise.all([unpack(EMBED.wasm), unpack(EMBED.cm), unpack(EMBED.lm)]);
  const agcs = { cm: await AGC.create(wasm, ropeCM, true), lm: await AGC.create(wasm, ropeLM, false) };
  for (const a of Object.values(agcs)) a.run(1.5);

  // ---------------- three.js ----------------
  const canvas = $('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 1e-5, 2e7);
  const cam = { az: 0.9, el: 0.12, dist: 0.42, distGoal: 0.42, U: new THREE.Vector3(0, 1, 0), E: new THREE.Vector3(1, 0, 0), N: new THREE.Vector3(0, 0, 1), snap: true };
  const camB = { az: 0.9, el: 0.32, dist: 0.035, distGoal: 0.035, U: new THREE.Vector3(0, 1, 0), E: new THREE.Vector3(1, 0, 0), N: new THREE.Vector3(0, 0, 1), snap: true };
  let ac = cam;
  const camAt = (cx, cy) => { if (!splitActive) return cam; const r = canvas.getBoundingClientRect(), x = cx - r.left, y = cy - r.top; return splitSide ? (x < r.width / 2 ? cam : camB) : (y < r.height / 2 ? cam : camB); };
  function clampDist(d) { return Math.max(0.01, Math.min(3e6, d)); }
  {
    const ptrs = new Map(); let pinch0 = 0, dist0 = 0;
    canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); if (!ptrs.size) ac = camAt(e.clientX, e.clientY); ptrs.set(e.pointerId, [e.clientX, e.clientY]); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); dist0 = ac.distGoal; } });
    canvas.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId)) return; const p = ptrs.get(e.pointerId); const dx = e.clientX - p[0], dy = e.clientY - p[1]; ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptrs.size === 1) { ac.elGoal = null; ac.az -= dx * 0.006; ac.el = Math.max(-1.45, Math.min(1.45, ac.el + dy * 0.006)); }
      else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch0 > 0) ac.distGoal = clampDist(dist0 * pinch0 / d); }
    });
    const end = (e) => { ptrs.delete(e.pointerId); pinch0 = 0; };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); const c = camAt(e.clientX, e.clientY); c.distGoal = clampDist(c.distGoal * Math.exp(e.deltaY * 0.0012)); }, { passive: false });
  }

  // ECI (x,y,z) -> scene (x, z, -y); floating origin at F
  let F = [0, 0, 0];
  const toV3 = (p, out) => (out || new THREE.Vector3()).set(p[0] - F[0], p[2] - F[2], -(p[1] - F[1]));
  const dirV3 = (d, out) => (out || new THREE.Vector3()).set(d[0], d[2], -d[1]);
  let sunDir = M.sunDir(0);
  const sunV = dirV3(sunDir).normalize();
  const skyCol = new THREE.Color(0x05070b);
  const sun = new THREE.DirectionalLight(0xfff4e6, 2.1); sun.position.copy(sunV); scene.add(sun);
  scene.add(new THREE.AmbientLight(0x2a3340, 0.45));

  const tex = (uri) => { const t = new THREE.TextureLoader().load(uri); t.anisotropy = 4; return t; };
  const TX = { day: tex(EMBED.tex.day), night: tex(EMBED.tex.night), clouds: tex(EMBED.tex.clouds), spec: tex(EMBED.tex.spec), moon: tex(EMBED.tex.moon) };

  const NOISE = `
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;} vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);} vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
   vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
   vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;i=mod289(i);
   vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
   float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
   vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
   vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
   vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
   vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
   vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
   return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));}
  float fbm(vec3 p){float f=0.0,a=0.5;for(int i=0;i<4;i++){f+=a*snoise(p);p*=2.03;a*=0.5;}return f;}
  vec3 hash33(vec3 p){ p=fract(p*vec3(0.1031,0.1030,0.0973)); p+=dot(p,p.yxz+33.33); return fract((p.xxy+p.yxx)*p.zyx); }
  // crater field: bowl, raised rim, ejecta skirt; returns height in units of the cell size
  float craters(vec3 x){ vec3 i=floor(x), f=fract(x); float h=0.0;
    for(int k=-1;k<=1;k++) for(int j=-1;j<=1;j++) for(int l=-1;l<=1;l++){
      vec3 g=vec3(float(l),float(j),float(k)), r=hash33(i+g+71.0); if(r.y>0.62) continue;
      vec3 d=g+r-f; float rad=0.12+0.33*r.x*r.x, u=length(d)/rad;
      if(u<1.8){ h += rad*( (u<1.0 ? 0.45*(u*u-1.0) : 0.0) + 0.16*exp(-pow((u-1.0)/0.18,2.0)) + 0.03*max(0.0,1.8-u) ); }
    }
    return h; }
  vec3 bumpNormal(vec3 surfPos, vec3 n, float hgt){
    vec3 sx=dFdx(surfPos), sy=dFdy(surfPos); vec3 r1=cross(sy,n), r2=cross(n,sx); float det=dot(sx,r1);
    vec2 dh=vec2(dFdx(hgt),dFdy(hgt)); vec3 grad=sign(det)*(dh.x*r1+dh.y*r2); return normalize(abs(det)*n-grad); }`;
  const VERT = `#include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vObj; varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying vec3 vPos; uniform vec3 uOff;
  void main(){ vObj=normalize(position+uOff); vPos=position+uOff; vUv=uv; vN=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz;
    gl_Position=projectionMatrix*viewMatrix*w;
    #include <logdepthbuf_vertex>
  }`;
  const earthMat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunV }, uOriginW: { value: new THREE.Vector3() }, uBodyInv: { value: new THREE.Matrix3() }, uNear: { value: 0 }, uHaze: { value: 0 }, uKsc: { value: new THREE.Vector3() }, uKscOn: { value: 1 }, uEastE: { value: new THREE.Vector3() }, uNorthE: { value: new THREE.Vector3() }, uBay: { value: [] }, uGulf: { value: [] }, uDtn: { value: new THREE.Vector2() }, uDay: { value: TX.day }, uNight: { value: TX.night }, uClouds: { value: TX.clouds }, uSpec: { value: TX.spec } }, extensions: { derivatives: true },
    vertexShader: VERT,
    fragmentShader: `#include <logdepthbuf_pars_fragment>
    uniform vec3 uSun; uniform vec3 uOriginW; uniform mat3 uBodyInv; uniform float uNear; uniform float uHaze; uniform vec3 uKsc; uniform float uKscOn; uniform vec3 uEastE; uniform vec3 uNorthE; uniform vec2 uBay[17]; uniform vec2 uGulf[13]; uniform vec2 uDtn; uniform sampler2D uDay, uNight, uClouds, uSpec; varying vec3 vObj; varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying vec3 vPos; ${NOISE}
    // Atlantic coastline around Cape Canaveral: km east of Pad 39A as a function of km north
    float coastE(float n){
      if(n<-34.3) return mix(3.0,-0.6,(n+60.0)/25.7); if(n<-23.2) return mix(-0.6,1.4,(n+34.3)/11.1);
      if(n<-16.5) return mix(1.4,7.2,(n+23.2)/6.7);   if(n<-9.8) return mix(7.2,4.3,(n+16.5)/6.7);
      if(n<0.0) return mix(4.3,0.6,(n+9.8)/9.8);       if(n<10.2) return mix(0.6,-4.5,n/10.2);
      if(n<21.3) return mix(-4.5,-10.4,(n-10.2)/11.1); if(n<37.9) return mix(-10.4,-22.1,(n-21.3)/16.6);
      return mix(-22.1,-31.8,(n-37.9)/16.7); }
    // signed distance (km) to the Galveston Bay and Gulf outlines around Houston; negative = water
    float sdBay(vec2 p){ float d=1e9, s=1.0;
      for(int i=0;i<16;i++){ vec2 vi=uBay[i+1], vj=uBay[i], e=vj-vi, w=p-vi, b=w-e*clamp(dot(w,e)/dot(e,e),0.0,1.0); d=min(d,dot(b,b));
        bvec3 c=bvec3(p.y>=vi.y, p.y<vj.y, e.x*w.y>e.y*w.x); if(all(c)||all(not(c))) s=-s; }
      return s*sqrt(d); }
    float sdGulf(vec2 p){ float d=1e9, s=1.0;
      for(int i=0;i<12;i++){ vec2 vi=uGulf[i+1], vj=uGulf[i], e=vj-vi, w=p-vi, b=w-e*clamp(dot(w,e)/dot(e,e),0.0,1.0); d=min(d,dot(b,b));
        bvec3 c=bvec3(p.y>=vi.y, p.y<vj.y, e.x*w.y>e.y*w.x); if(all(c)||all(not(c))) s=-s; }
      return s*sqrt(d); }
    float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; return length(pa-ba*clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0)); }
    void main(){
      vec3 N=normalize(vN), V=normalize(cameraPosition-vW);
      vec3 day=texture2D(uDay,vUv).rgb;
      float w=max(fwidth(vObj.x),fwidth(vObj.y)); float near=1.0-smoothstep(2e-5,4e-4,w);
      day*=1.0+near*0.18*fbm(vObj*9000.0);
      vec3 q=uBodyInv*(vW-uOriginW); float fp=length(fwidth(q)); float sea=texture2D(uSpec,vUv).r;
      float cl=texture2D(uClouds,vUv).r*(1.0-0.6*near);
      // The global texture is ~10 km per pixel, too coarse for the Cape: draw the coast, Merritt Island,
      // the Banana and Indian Rivers and Mosquito Lagoon procedurally around the pad
      if(uNear>0.5 && uKscOn>1.5){
        // Houston: coastal prairie, the city, Clear Lake, Galveston Bay and the Gulf
        vec2 L=vec2(dot(q,uEastE),dot(q,uNorthE)); float rr=length(L);
        if(rr<130.0){
          float jit=0.4*fbm(q/2.3)+0.06*fbm(q/0.15);
          float sw=min(sdBay(L),sdGulf(L))+jit;
          sw=min(sw, sdSeg(L,vec2(1.6,-0.6),vec2(6.6,-0.7))-0.55+0.1*fbm(q/0.6));   // Clear Lake
          float water=1.0-smoothstep(-0.02,0.02,sw);
          float beach=(1.0-water)*(1.0-smoothstep(0.02,0.07,sw))*step(-30.0,-rr+30.0);
          float urb=(1.0-smoothstep(6.0,26.0,length(L-uDtn)))*(0.55+0.45*smoothstep(-0.2,0.4,fbm(q/0.35+9.0)));
          vec3 landC=mix(vec3(0.18,0.23,0.12),vec3(0.30,0.30,0.18),smoothstep(-0.4,0.5,fbm(q/1.1)));
          landC=mix(landC,vec3(0.13,0.19,0.09),smoothstep(0.15,0.6,fbm(q/0.3+3.0))*0.5);
          landC=mix(landC,vec3(0.36,0.34,0.31)*(0.85+0.3*fbm(q/0.05)),urb*0.8);
          vec3 g=mix(landC,vec3(0.72,0.66,0.52),beach*0.8);
          g=mix(g,mix(vec3(0.07,0.12,0.12),vec3(0.04,0.10,0.16),smoothstep(0.0,8.0,-sw)),water);
          float wM=1.0-smoothstep(100.0,130.0,rr);
          day=mix(day,g,wM); sea=mix(sea,water,wM); cl*=1.0-0.85*wM;
        }
      } else if(uNear>0.5 && uKscOn>0.5){
        vec2 L=vec2(dot(q,uEastE),dot(q,uNorthE)); float rr=length(L);
        if(rr<95.0){
          float jit=0.35*fbm(q/1.7)+0.06*fbm(q/0.15);
          float ce=coastE(L.y)+jit;
          float ocean=smoothstep(-0.015,0.015,L.x-ce);
          float ir=(1.0-smoothstep(1.1,1.5,abs(L.x+11.3+0.1*L.y+jit)))*step(-60.0,L.y)*step(L.y,25.0);
          float br=(1.0-smoothstep(0.8,1.2,abs(L.x-ce+5.5)))*step(-35.0,L.y)*step(L.y,-3.0);
          float ml=(1.0-smoothstep(0.9,1.3,abs(L.x-ce+3.2)))*step(12.0,L.y)*step(L.y,45.0);
          float lag=max(ir,max(br,ml))*(1.0-ocean);
          float beach=(1.0-ocean)*(1.0-smoothstep(0.03,0.08,ce-L.x));
          vec3 landC=mix(vec3(0.15,0.20,0.10),vec3(0.27,0.27,0.16),smoothstep(-0.4,0.5,fbm(q/0.9)));
          landC=mix(landC,vec3(0.10,0.16,0.08),smoothstep(0.1,0.6,fbm(q/0.25+3.0))*0.6);
          vec3 g=mix(landC,vec3(0.80,0.74,0.60),beach);
          g=mix(g,vec3(0.05,0.10,0.11),lag);
          g=mix(g,vec3(0.03,0.09,0.17),ocean);
          float wM=1.0-smoothstep(70.0,95.0,rr);
          day=mix(day,g,wM); sea=mix(sea,max(ocean,lag*0.7),wM); cl*=1.0-0.85*wM;
        }
      }
      float ndl=dot(N,uSun), lit=smoothstep(-0.12,0.22,ndl);
      vec3 col=mix(day,vec3(0.95),cl)*(0.02+1.1*clamp(ndl+0.05,0.0,1.0));
      // close-range detail: fields, scrub and wave texture anchored near the pad / recovery area
      if(uNear>0.5){
        float a1=1.0-smoothstep(0.05,0.5,fp/1.5), a2=1.0-smoothstep(0.05,0.5,fp/0.12), a3=1.0-smoothstep(0.05,0.5,fp/0.015);
        float land=1.0-sea;
        float fields=fbm(q/1.5)*a1+0.6*fbm(q/0.12)*a2+0.35*fbm(q/0.015)*a3;
        vec3 tint=mix(vec3(0.85,0.95,0.8),vec3(1.15,1.05,0.85),smoothstep(-0.3,0.3,fbm(q/3.0+7.0)));
        col*=mix(vec3(1.0),tint*(1.0+0.35*fields),land*a1);
        float waves=fbm(q/0.04)*a2+0.5*fbm(q/0.006)*a3; vec3 Nw=bumpNormal(vW,N,waves*0.0006*sea);
        col*=1.0+0.15*waves*sea*a2;
        vec3 Rw=reflect(-uSun,Nw); col+=vec3(1.0,0.92,0.8)*sea*pow(max(dot(Rw,V),0.0),60.0)*0.8*step(0.0,ndl)*a2;
      }
      float sp=sea*(1.0-cl); vec3 R=reflect(-uSun,N); col+=vec3(1.0,0.9,0.75)*sp*pow(max(dot(R,V),0.0),36.0)*0.55*step(0.0,ndl);
      vec3 night=texture2D(uNight,vUv).rgb*vec3(1.0,0.82,0.55)*1.4*(1.0-cl);
      if(uNear>0.5){
        // up close the ~10 km city-light pixels become scattered streetlights instead of a glowing blanket
        float a1=1.0-smoothstep(0.05,0.5,fp/1.5), a2=1.0-smoothstep(0.05,0.5,fp/0.12);
        night*=mix(1.0,0.15+1.6*smoothstep(0.25,0.8,fbm(q/0.8)),a1);
        night*=mix(1.0,0.1+3.0*smoothstep(0.55,0.9,fbm(q/0.05)),a2);
        night*=(1.0-sea)*mix(1.0,0.4,uHaze);
      }
      col+=night*(1.0-lit);
      // faint starlight/airglow on the night side so the dark Earth still reads as a globe
      col+=mix(day,vec3(0.35),cl)*vec3(0.55,0.65,0.9)*0.06*(1.0-lit);
      float rim=pow(1.0-max(dot(N,V),0.0),3.0); col+=vec3(0.25,0.45,0.9)*rim*0.35*lit+vec3(0.12,0.30,0.20)*rim*0.25*(1.0-lit);
      // aerial perspective: distant ground fades into blue haze when you are low in the atmosphere
      float dist=length(vW-cameraPosition);
      float fog=(1.0-exp(-dist/45.0))*uHaze;
      vec3 hazeCol=mix(vec3(0.02,0.03,0.06),vec3(0.58,0.70,0.88),smoothstep(-0.1,0.3,ndl));
      col=mix(col,hazeCol,fog);
      gl_FragColor=vec4(col,1.0);
      #include <logdepthbuf_fragment>
    }`,
  });
  const moonMat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunV }, uOriginW: { value: new THREE.Vector3() }, uBodyInv: { value: new THREE.Matrix3() }, uNear: { value: 0 }, uEastB: { value: new THREE.Vector3() }, uNorthB: { value: new THREE.Vector3() }, uMap: { value: TX.moon } }, extensions: { derivatives: true },
    vertexShader: VERT,
    fragmentShader: `#include <logdepthbuf_pars_fragment>
    uniform vec3 uSun; uniform vec3 uOriginW; uniform mat3 uBodyInv; uniform float uNear; uniform vec3 uEastB; uniform vec3 uNorthB; uniform sampler2D uMap; varying vec3 vObj; varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying vec3 vPos; ${NOISE}
    void main(){
      vec3 N=normalize(vN), V=normalize(cameraPosition-vW);
      vec3 col=texture2D(uMap,vUv).rgb;
      vec3 q=uBodyInv*(vW-uOriginW);                       // km from the landing site, for precise close-range detail
      float fp=length(fwidth(q));                // ground size of one pixel, km
      float hgt=0.0, alb=0.0;
      if(uNear>0.5){
        float sc=2.4;
        for(int o=0;o<6;o++){ float fade=1.0-smoothstep(0.08,0.45,fp/sc); hgt+=craters(q/sc)*sc*fade; sc*=0.3; }
        float f1=1.0-smoothstep(0.02,0.2,fp/0.25), f2=1.0-smoothstep(0.02,0.2,fp/0.02);
        hgt+=0.006*fbm(q/0.25)*f1+0.0008*fbm(q/0.02)*f2;
        // real craters near Tranquility Base (east/north of Eagle, km): Little West (Armstrong's EVA) and West (avoided on landing)
        vec2 L=vec2(dot(q,uEastB),dot(q,uNorthB));
        for(int c=0;c<2;c++){ vec2 cc=c==0?vec2(0.070,-0.006):vec2(-0.40,0.01); float r=c==0?0.015:0.095;
          float x=length(L-cc)/r; float fade=1.0-smoothstep(0.1,0.5,fp/r);
          hgt+=fade*r*((x<1.0?0.42*(x*x-1.0):0.0)+0.13*exp(-pow((x-1.0)/0.2,2.0))+(c==1?0.02*max(0.0,2.2-x)*fbm(q/0.004):0.0)); }
        alb=0.12*fbm(q/1.3)*(1.0-smoothstep(0.1,0.6,fp))+0.08*fbm(q/0.08)*f1;
        N=bumpNormal(vW,N,hgt);
      }
      col*=1.0+alb+clamp(hgt*30.0,-0.1,0.18)*(1.0-smoothstep(0.05,0.5,fp));
      float mu0=max(dot(N,uSun),0.0), mu=max(dot(N,V),0.05);
      float ls=2.0*mu0/(mu0+mu);   // Lommel-Seeliger law: why the full Moon looks flat, not shaded like a ball
      gl_FragColor=vec4(col*(0.008+0.9*ls),1.0);
      #include <logdepthbuf_fragment>
    }`,
  });
  const atmoMat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunV } }, side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    vertexShader: VERT,
    fragmentShader: `#include <logdepthbuf_pars_fragment>
    uniform vec3 uSun; varying vec3 vObj; varying vec3 vN; varying vec3 vW; varying vec2 vUv;
    void main(){ vec3 v=normalize(cameraPosition-vW); float rim=pow(1.0-abs(dot(normalize(vN),v)),2.4);
      float day=smoothstep(-0.25,0.35,dot(normalize(vN),uSun));
      gl_FragColor=vec4(vec3(0.32,0.58,1.0)*rim*day*1.15,1.0);
      #include <logdepthbuf_fragment>
    }`,
  });
  // High-resolution cap at a point of interest (avoids chord sag of the coarse sphere); global UVs.
  function capGeom(radius, lat, lon, size) {
    const g = new THREE.SphereGeometry(radius, 192, 192, (lon + 180) * D2R - size / 2, size, (90 - lat) * D2R - size / 2, size);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); let phi = Math.atan2(z, -x); if (phi < 0) phi += Math.PI * 2; uv.setXY(i, phi / (Math.PI * 2), 1 - Math.acos(Math.max(-1, Math.min(1, y / radius))) / Math.PI); }
    uv.needsUpdate = true; return g;
  }
  // The cap is built around its own centre (subtracted in double precision) so that, with the
  // camera's floating origin next to it, ground vertices are tiny numbers the GPU keeps exact.
  function body(radius, mat, caps) {
    const g = new THREE.Group();
    mat.uniforms.uOff = { value: new THREE.Vector3() };
    g.add(new THREE.Mesh(new THREE.SphereGeometry(radius - 0.002, 256, 160), mat));
    for (const cap of [].concat(caps || [])) {
      const geo = capGeom(radius, cap.lat, cap.lon, 0.04);
      const la = cap.lat * D2R, lo = cap.lon * D2R, c = new THREE.Vector3(radius * Math.cos(la) * Math.cos(lo), radius * Math.sin(la), -radius * Math.cos(la) * Math.sin(lo));
      const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) - c.x, p.getY(i) - c.y, p.getZ(i) - c.z); p.needsUpdate = true;
      geo.computeBoundingSphere();
      const cm = new THREE.ShaderMaterial({ uniforms: Object.assign({}, mat.uniforms, { uOff: { value: c } }), vertexShader: mat.vertexShader, fragmentShader: mat.fragmentShader, extensions: mat.extensions });
      const mesh = new THREE.Mesh(geo, cm); mesh.position.copy(c); g.add(mesh);
    }
    return g;
  }
  const geoObj = (lat, lon, r) => new THREE.Vector3(r * Math.cos(lat * D2R) * Math.cos(lon * D2R), r * Math.sin(lat * D2R), -r * Math.cos(lat * D2R) * Math.sin(lon * D2R));
  { const la = SITE.lat * D2R, lo = SITE.lon * D2R; moonMat.uniforms.uEastB.value.set(-Math.sin(lo), 0, -Math.cos(lo)); moonMat.uniforms.uNorthB.value.set(-Math.sin(la) * Math.cos(lo), Math.cos(la), Math.sin(la) * Math.sin(lo)); }
  { const la = KSC.lat * D2R, lo = KSC.lon * D2R; earthMat.uniforms.uEastE.value.set(-Math.sin(lo), 0, -Math.cos(lo)); earthMat.uniforms.uNorthE.value.set(-Math.sin(la) * Math.cos(lo), Math.cos(la), Math.sin(la) * Math.sin(lo)); }
  const earth = body(R_E, earthMat, [KSC, HOUCAP]); scene.add(earth);
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R_E * 1.025, 96, 64), atmoMat); scene.add(atmo);
  const moon = body(R_M, moonMat, SITE); scene.add(moon);
  const basisM = new THREE.Matrix4();
  function orientMoon(t) { const ax = M.moonAxes(t); basisM.makeBasis(dirV3(ax.x), dirV3(ax.z), dirV3(mul(ax.y, -1))); moon.setRotationFromMatrix(basisM); }
  {
    const n = 5000, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      pos.set([r * Math.cos(th) * 1e7, u * 1e7, r * Math.sin(th) * 1e7], i * 3);
      const b = 0.3 + 0.7 * Math.pow(rnd(), 3), warm = rnd(); col.set([b * (0.9 + 0.1 * warm), b * 0.95, b * (1.0 - 0.15 * warm)], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
    stars.frustumCulled = false; scene.add(stars); scene.userData.stars = stars;
  }

  // ---------------- vehicle models (metres -> km) ----------------
  const mm = 0.001;
  const matWhite = new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.55, metalness: 0.1 });
  const matBlack = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 });
  const matSilver = new THREE.MeshStandardMaterial({ color: 0xd4d7dc, roughness: 0.38, metalness: 0.35 });
  const matCM = new THREE.MeshStandardMaterial({ color: 0xe2e4e8, roughness: 0.25, metalness: 0.45 });
  const matGold = new THREE.MeshStandardMaterial({ color: 0xd4a23a, roughness: 0.4, metalness: 0.45 });
  const matLMgrey = new THREE.MeshStandardMaterial({ color: 0x8e9196, roughness: 0.6, metalness: 0.35 });
  const matBell = new THREE.MeshStandardMaterial({ color: 0x3b3a3a, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide });
  const matShield = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.9 });
  const cyl = (rTop, rBot, h, mat, y, seg = 32) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop * mm, rBot * mm, h * mm, seg), mat); m.position.y = (y + h / 2) * mm; return m; };
  function bell(rThroat, rExit, h, y) { const m = new THREE.Mesh(new THREE.CylinderGeometry(rThroat * mm, rExit * mm, h * mm, 24, 1, true), matBell); m.position.y = (y - h / 2) * mm; return m; }
  function plume(len, rad, color, y) {
    const g = new THREE.Group();
    const m1 = new THREE.Mesh(new THREE.ConeGeometry(rad * mm, len * mm, 24, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m1.rotation.x = Math.PI; m1.position.y = (y - len / 2) * mm;
    const m2 = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.45 * mm, len * 0.45 * mm, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff6dd, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m2.rotation.x = Math.PI; m2.position.y = (y - len * 0.225) * mm;
    g.add(m1, m2); g.visible = false; return g;
  }
  function makeCSM() {
    const g = new THREE.Group(), sm = new THREE.Group();
    sm.add(cyl(1.96, 1.96, 7.5, matSilver, 0));
    for (let i = 0; i < 4; i++) { const q = new THREE.Mesh(new THREE.BoxGeometry(0.5 * mm, 0.9 * mm, 0.9 * mm), matSilver); const a = i * Math.PI / 2 + 0.3; q.position.set(Math.cos(a) * 2.05 * mm, 6.2 * mm, Math.sin(a) * 2.05 * mm); sm.add(q); }
    sm.add(bell(0.6, 1.25, 3.9, 0));
    const hga = new THREE.Mesh(new THREE.BoxGeometry(1.6 * mm, 1.6 * mm, 0.3 * mm), matSilver); hga.position.set(-2.8 * mm, 0.6 * mm, 0); sm.add(hga);
    const pl = plume(14, 2.6, 0xff9a3a, -3.9); sm.add(pl);
    g.add(sm); g.userData.sm = sm; g.userData.plume = pl;
    const cm = new THREE.Group(); cm.add(cyl(0.4, 1.96, 3.2, matCM, 7.5)); cm.add(cyl(0.35, 0.4, 0.4, matCM, 10.7)); cm.add(cyl(1.96, 2.0, 0.15, matShield, 7.35));
    g.add(cm); g.userData.cm = cm;
    const glow = new THREE.Mesh(new THREE.SphereGeometry(3.4 * mm, 24, 16), new THREE.MeshBasicMaterial({ color: 0xff7a30, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.y = 7.2 * mm; glow.scale.set(1, 0.55, 1); g.add(glow); g.userData.glow = glow;
    const chuteMat = new THREE.MeshStandardMaterial({ color: 0xf2efe9, roughness: 0.9, side: THREE.DoubleSide }), chuteMatR = new THREE.MeshStandardMaterial({ color: 0xd2492e, roughness: 0.9, side: THREE.DoubleSide });
    const drogues = new THREE.Group(), mains = new THREE.Group();
    for (let i = 0; i < 2; i++) { const d = new THREE.Mesh(new THREE.SphereGeometry(2.5 * mm, 16, 8, 0, Math.PI * 2, 0, 1.2), i ? chuteMatR : chuteMat); d.position.set((i ? 2 : -2) * mm, 40 * mm, 0); drogues.add(d); }
    for (let i = 0; i < 3; i++) { const a = i * 2.094; const d = new THREE.Mesh(new THREE.SphereGeometry(13 * mm, 24, 10, 0, Math.PI * 2, 0, 1.25), i % 2 ? chuteMatR : chuteMat); d.position.set(Math.cos(a) * 11 * mm, 55 * mm, Math.sin(a) * 11 * mm); mains.add(d); }
    drogues.visible = mains.visible = false; g.add(drogues, mains); g.userData.drogues = drogues; g.userData.mains = mains;
    return g;
  }
  function makeLM() {
    const g = new THREE.Group(), desc = new THREE.Group();
    const box = new THREE.Mesh(new THREE.CylinderGeometry(2.1 * mm, 2.1 * mm, 1.65 * mm, 8), matGold); box.position.y = 2.1 * mm; desc.add(box);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * mm, 0.08 * mm, 3.3 * mm, 6), matSilver); leg.position.set(Math.cos(a) * 3.0 * mm, 1.5 * mm, Math.sin(a) * 3.0 * mm); leg.rotation.z = Math.cos(a) * 0.5; leg.rotation.x = -Math.sin(a) * 0.5; desc.add(leg);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.47 * mm, 0.47 * mm, 0.12 * mm, 12), matSilver); pad.position.set(Math.cos(a) * 3.9 * mm, 0.06 * mm, Math.sin(a) * 3.9 * mm); desc.add(pad);
    }
    desc.add(bell(0.4, 0.75, 1.4, 1.3));
    const dpl = plume(6, 1.4, 0xffb060, -0.1); desc.add(dpl);
    const asc = new THREE.Group();
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(1.4 * mm, 1.6 * mm, 2.4 * mm, 8), matLMgrey); cab.position.y = 4.3 * mm; asc.add(cab);
    const fr = new THREE.Mesh(new THREE.BoxGeometry(2.4 * mm, 1.2 * mm, 1.2 * mm), matBlack); fr.position.set(1.0 * mm, 4.0 * mm, 0); asc.add(fr);
    const tun = new THREE.Mesh(new THREE.CylinderGeometry(0.5 * mm, 0.5 * mm, 0.6 * mm, 16), matLMgrey); tun.position.y = 5.8 * mm; asc.add(tun);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.45 * mm, 0.1 * mm, 0.3 * mm, 12), matSilver); ant.position.set(-1.2 * mm, 5.9 * mm, 0.8 * mm); asc.add(ant);
    const apl = plume(5, 0.9, 0xffc070, 3.0); asc.add(apl);
    g.add(desc, asc); g.userData = { desc, asc, dpl, apl }; return g;
  }
  function makeSaturn() {
    const g = new THREE.Group();
    const sic = new THREE.Group(); sic.add(cyl(5.05, 5.05, 42, matWhite, 0)); sic.add(cyl(5.06, 5.06, 6, matBlack, 6)); sic.add(cyl(5.06, 5.06, 4, matBlack, 30));
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; const f = new THREE.Mesh(new THREE.BoxGeometry(0.4 * mm, 6 * mm, 4 * mm), matWhite); f.position.set(Math.cos(a) * 6.2 * mm, 3 * mm, Math.sin(a) * 6.2 * mm); f.rotation.y = -a; sic.add(f); }
    const pIc = plume(120, 13, 0xff8a2a, 0); sic.add(pIc);
    const sii = new THREE.Group(); sii.add(cyl(5.05, 5.05, 5.5, matWhite, 42)); sii.add(cyl(5.05, 5.05, 24.9, matWhite, 47.5)); sii.add(cyl(5.06, 5.06, 3, matBlack, 47.5));
    const pII = plume(40, 7, 0x9fb8ff, 47.5); sii.add(pII);
    const sivb = new THREE.Group(); sivb.add(cyl(3.3, 5.05, 5, matWhite, 72.4)); sivb.add(cyl(3.3, 3.3, 17.8, matWhite, 77.4)); sivb.add(cyl(3.3, 3.3, 0.9, matBlack, 95.2));
    const pIVB = plume(25, 3.5, 0xa9c0ff, 77.4); sivb.add(pIVB);
    const sla = cyl(1.96, 3.3, 8.5, matWhite, 96.1);
    const csm = makeCSM(); csm.position.y = 104.6 * mm;
    const les = new THREE.Group(); les.add(cyl(0.35, 0.9, 4.6, new THREE.MeshStandardMaterial({ color: 0x8c3a2a, roughness: 0.7 }), 115.6, 4)); les.add(cyl(0.33, 0.33, 4.7, matWhite, 120.2)); les.add(cyl(0.05, 0.33, 2.2, matBlack, 124.9));
    g.add(sic, sii, sivb, sla, csm, les); g.userData = { sic, sii, sivb, sla, csm, les, pIc, pII, pIVB }; return g;
  }
  function makeSIVB() { const g = new THREE.Group(); g.add(cyl(3.3, 3.3, 17.8, matWhite, 0)); g.add(cyl(3.3, 3.3, 0.9, matBlack, 17.8)); g.add(bell(0.5, 1.0, 3.4, 0)); const pl = plume(25, 3.5, 0xa9c0ff, -3.4); g.add(pl); g.userData.plume = pl; return g; }
  const saturn = makeSaturn(); scene.add(saturn);
  const csm = makeCSM(); scene.add(csm);
  const lm = makeLM(); scene.add(lm);
  const lmDocked = makeLM(); scene.add(lmDocked);
  const lmDescentLeft = makeLM(); lmDescentLeft.userData.asc.visible = false; scene.add(lmDescentLeft);
  const sivbM = makeSIVB(); scene.add(sivbM);
  const slaPanels = new THREE.Group(); sivbM.add(slaPanels);
  { const pm = matWhite.clone(); pm.side = THREE.DoubleSide;
    for (let i = 0; i < 4; i++) {
      const th = i * Math.PI / 2 + Math.PI / 4, sn = Math.sin(th), cs = Math.cos(th);
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1.96 * mm, 3.3 * mm, 8.5 * mm, 10, 1, true, th - Math.PI / 4, Math.PI / 2), pm);
      mesh.position.set(-3.3 * sn * mm, 4.25 * mm, -3.3 * cs * mm);
      const pv = new THREE.Group(); pv.add(mesh); pv.userData = { hinge: new THREE.Vector3(3.3 * sn * mm, 18.7 * mm, 3.3 * cs * mm), axis: new THREE.Vector3(cs, 0, -sn), out: new THREE.Vector3(sn, 0.3, cs).normalize() };
      pv.position.copy(pv.userData.hinge); slaPanels.add(pv);
    } }
  const smSpent = makeCSM(); ['cm', 'glow', 'plume', 'drogues', 'mains'].forEach((k) => { if (smSpent.userData[k]) smSpent.userData[k].visible = false; }); smSpent.visible = false; scene.add(smSpent);
  const spentIC = makeSaturn(); ['sii', 'sivb', 'sla', 'csm', 'les'].forEach((k) => (spentIC.userData[k].visible = false)); scene.add(spentIC);
  const spentII = makeSaturn(); ['sic', 'sivb', 'sla', 'csm', 'les'].forEach((k) => (spentII.userData[k].visible = false)); scene.add(spentII);
  // ---------------- EVA: astronauts, footprints, equipment (metres in a site-local frame) ----------------
  const evaGroup = new THREE.Group(); scene.add(evaGroup);
  const matSuit = new THREE.MeshStandardMaterial({ color: 0xf2f1ec, roughness: 0.8 });
  const matVisor = new THREE.MeshStandardMaterial({ color: 0xd9a531, roughness: 0.15, metalness: 0.9 });
  const mb = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w * mm, h * mm, d * mm), mat); m.position.set(x * mm, y * mm, z * mm); return m; };
  function makeAstro(stripe) {
    const g = new THREE.Group(), legs = [];
    for (const sx of [-0.13, 0.13]) { const leg = new THREE.Group(); const l = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * mm, 0.12 * mm, 0.82 * mm, 10), matSuit); l.position.y = -0.41 * mm; leg.add(l); leg.add(mb(0.18, 0.1, 0.3, matSuit, 0, -0.84, 0.05)); leg.position.set(sx * mm, 0.88 * mm, 0); g.add(leg); legs.push(leg); }
    g.add(mb(0.55, 0.72, 0.36, matSuit, 0, 1.22, 0));
    g.add(mb(0.52, 0.7, 0.26, matSuit, 0, 1.3, -0.3));                  // PLSS backpack
    for (const sx of [-0.36, 0.36]) { const a = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * mm, 0.09 * mm, 0.62 * mm, 8), matSuit); a.position.set(sx * mm, 1.22 * mm, 0.05 * mm); a.rotation.x = -0.25; g.add(a); }
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.2 * mm, 18, 12), matSuit); helmet.position.y = 1.72 * mm; g.add(helmet);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.205 * mm, 18, 12, -Math.PI / 2.4, Math.PI / 1.2, Math.PI / 4, Math.PI / 2.4), matVisor); visor.position.y = 1.72 * mm; visor.rotation.y = Math.PI / 2; g.add(visor);
    if (stripe) g.add(mb(0.57, 0.06, 0.38, new THREE.MeshStandardMaterial({ color: 0xb22234, roughness: 0.7 }), 0, 1.45, 0)); // Armstrong: commander's red band (added on later missions; used here to tell them apart)
    g.userData.legs = legs; return g;
  }
  const armstrong = makeAstro(true), aldrin = makeAstro(false); evaGroup.add(armstrong, aldrin);
  const FOOT = EVA.footprints();
  const feet = new THREE.InstancedMesh(new THREE.CircleGeometry(0.075 * mm, 10), new THREE.MeshStandardMaterial({ color: 0x2f2f2f, roughness: 1 }), FOOT.length);
  { const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(1, 2.1, 1);
    FOOT.forEach((f, i) => { e.set(-Math.PI / 2, 0, f.yaw); q.setFromEuler(e); m4.compose(new THREE.Vector3(f.e * mm, 0.004 * mm, -f.n * mm), q, sc); feet.setMatrixAt(i, m4); }); }
  feet.count = 0; evaGroup.add(feet);
  const gear = {};
  { // flag (stars and stripes drawn on a canvas)
    const c = document.createElement('canvas'); c.width = 190; c.height = 100; const x = c.getContext('2d');
    for (let i = 0; i < 13; i++) { x.fillStyle = i % 2 ? '#ffffff' : '#b22234'; x.fillRect(0, i * 100 / 13, 190, 100 / 13 + 0.5); }
    x.fillStyle = '#3c3b6e'; x.fillRect(0, 0, 76, 54); x.fillStyle = '#fff'; for (let r = 0; r < 9; r++) for (let k = 0; k < (r % 2 ? 5 : 6); k++) x.fillRect(5 + k * 12.6 + (r % 2 ? 6.3 : 0), 3 + r * 5.6, 2, 2);
    const g = new THREE.Group(), grey = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.5, roughness: 0.4 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.016 * mm, 0.016 * mm, 2.3 * mm, 8), grey); pole.position.y = 1.15 * mm; g.add(pole);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.01 * mm, 0.01 * mm, 0.95 * mm, 6), grey); bar.rotation.z = Math.PI / 2; bar.position.set(0.47 * mm, 2.28 * mm, 0); g.add(bar);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.92 * mm, 0.6 * mm, 8, 2), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(c), side: THREE.DoubleSide, roughness: 0.9 }));
    const pa = cloth.geometry.attributes.position; for (let i = 0; i < pa.count; i++) pa.setZ(i, Math.sin(pa.getX(i) / mm * 7) * 0.03 * mm); cloth.geometry.computeVertexNormals();
    cloth.position.set(0.47 * mm, 1.97 * mm, 0); g.add(cloth); gear.flag = g;
  }
  { const g = new THREE.Group(), dark = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });
    for (let i = 0; i < 3; i++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.01 * mm, 0.01 * mm, 1.2 * mm, 5), matSilver); const a = i * 2.094; l.position.set(Math.cos(a) * 0.18 * mm, 0.58 * mm, Math.sin(a) * 0.18 * mm); l.rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3); g.add(l); }
    g.add(mb(0.18, 0.15, 0.32, dark, 0, 1.22, 0)); gear.tv = g; }
  { const g = new THREE.Group(); const p = new THREE.Mesh(new THREE.CylinderGeometry(0.012 * mm, 0.012 * mm, 1.7 * mm, 6), matSilver); p.position.y = 0.85 * mm; g.add(p);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.3 * mm, 1.35 * mm), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, metalness: 0.95, roughness: 0.15, side: THREE.DoubleSide })); sh.position.set(0, 0.95 * mm, 0.02 * mm); g.add(sh); gear.swc = g; }
  { const g = new THREE.Group(), cell = new THREE.MeshStandardMaterial({ color: 0x1d2a52, metalness: 0.3, roughness: 0.4 });
    g.add(mb(0.42, 0.42, 0.42, matGold, 0, 0.25, 0));
    for (const sx of [-1, 1]) { const pnl = mb(0.62, 0.02, 0.5, cell, sx * 0.55, 0.42, 0); pnl.rotation.z = sx * 0.25; g.add(pnl); }
    gear.psep = g; }
  { const g = new THREE.Group(); const pnl = mb(0.62, 0.05, 0.46, new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.7, roughness: 0.3 }), 0, 0.32, 0); pnl.rotation.x = -0.55; g.add(pnl); g.add(mb(0.5, 0.18, 0.08, matSilver, 0, 0.1, 0.15)); gear.lrrr = g; }
  for (const [k, obj] of Object.entries(gear)) { const p = EVA.gear[k].at; obj.position.set(p[0] * mm, 0, -p[1] * mm); obj.visible = false; evaGroup.add(obj); }
  gear.flag.rotation.y = 0.6; gear.tv.rotation.y = 2.4; gear.swc.rotation.y = -1.2; gear.lrrr.rotation.y = 0.1;
  const siteBasis = (t) => { const o = siteAt(t), up = unit(sub(o, M.moonPos(t))), east = unit(cross(M.moonAxes(t).z, up)), north = cross(up, east); return { o, up, east, north }; };
  const basisTmp = new THREE.Matrix4();

  // ---------------- Houston: coastline outlines, Manned Spacecraft Center, downtown skyline ----------------
  const kmEN = (lat, lon, o) => new THREE.Vector2((lon - o.lon) * 111.32 * Math.cos(o.lat * D2R), (lat - o.lat) * 110.57);
  {
    // approximate outlines (lat, lon); closed by repeating the first point
    const BAY = [[29.760, -94.990], [29.690, -95.005], [29.620, -95.010], [29.560, -95.012], [29.500, -94.985], [29.430, -94.930], [29.370, -94.890], [29.320, -94.800],
      [29.330, -94.730], [29.420, -94.700], [29.500, -94.700], [29.520, -94.550], [29.560, -94.500], [29.620, -94.640], [29.700, -94.720], [29.760, -94.880]];
    const GULF = [[28.90, -95.40], [29.05, -95.15], [29.20, -94.95], [29.28, -94.82], [29.335, -94.725], [29.39, -94.60], [29.50, -94.40], [29.60, -94.10], [28.50, -93.50], [27.80, -95.00], [28.00, -95.90], [28.60, -95.90]];
    earthMat.uniforms.uBay.value = [...BAY, BAY[0]].map(([a, b]) => kmEN(a, b, MSC));
    earthMat.uniforms.uGulf.value = [...GULF, GULF[0]].map(([a, b]) => kmEN(a, b, MSC));
    earthMat.uniforms.uDtn.value = kmEN(DTN.lat, DTN.lon, MSC);
  }
  // facade texture: concrete with window bands; the emissive copy lights a random half of the windows at night
  function facadeTex(lit) {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    let seed = lit ? 11 : 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    g.fillStyle = lit ? '#000' : '#cfcac0'; g.fillRect(0, 0, 64, 64);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      if (lit) { if (rnd() < 0.45) { g.fillStyle = rnd() < 0.7 ? '#ffd9a0' : '#e8f0ff'; g.fillRect(x * 8 + 1, y * 8 + 2, 6, 4); } }
      else { g.fillStyle = '#3c4650'; g.fillRect(x * 8 + 1, y * 8 + 2, 6, 4); }
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter; return t;
  }
  const matOffice = new THREE.MeshStandardMaterial({ map: facadeTex(false), emissiveMap: facadeTex(true), emissive: new THREE.Color(0xffffff), emissiveIntensity: 0, roughness: 0.8 });
  const matTower = new THREE.MeshStandardMaterial({ map: facadeTex(false), emissiveMap: facadeTex(true), emissive: new THREE.Color(0xffffff), emissiveIntensity: 0, roughness: 0.6, metalness: 0.15, color: 0xdde4ea });
  const matBlank = new THREE.MeshStandardMaterial({ color: 0xd8d3c8, roughness: 0.9 });
  const matHangar = new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.7, metalness: 0.2 });
  const matAsphalt = new THREE.MeshStandardMaterial({ color: 0x3d3f42, roughness: 1 });
  const matRoad = new THREE.MeshStandardMaterial({ color: 0x8a8781, roughness: 1 });
  const matPond = new THREE.MeshStandardMaterial({ color: 0x1d3a4a, roughness: 0.2, metalness: 0.3 });
  // box standing on the local ground: e/n = centre (m east/north), w = east-west size, d = north-south size, h = height
  function bldg(g, e, n, w, d, h, mat, rotY) {
    const geo = new THREE.BoxGeometry(w * mm, h * mm, d * mm), uv = geo.attributes.uv;
    if (mat.map) for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
      const i = f * 4 + k, horiz = f === 2 || f === 3, span = f < 2 ? d : w;
      if (horiz) uv.setXY(i, 0.005, 0.005); else uv.setXY(i, uv.getX(i) * span / 6 / 8, uv.getY(i) * h / 3.8 / 8);
    }
    const m = new THREE.Mesh(geo, mat); m.position.set(e * mm, (h / 2 - 2 - (e * e + n * n) / 1.2756e7) * mm, -n * mm); if (rotY) m.rotation.y = rotY; g.add(m); return m;
  }
  function flat(g, e, n, w, d, mat, y, rot) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w * mm, d * mm), mat); m.rotation.x = -Math.PI / 2; if (rot) m.rotation.z = rot; m.position.set(e * mm, ((y || 0.3) - (e * e + n * n) / 1.2756e7) * mm, -n * mm); g.add(m); return m; }
  // a strip along a polyline of [east, north] metres, laid in short pieces so it follows the Earth's curve
  function strip(g, pts, width, mat, y) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [e0, n0] = pts[i], [e1, n1] = pts[i + 1], L = Math.hypot(e1 - e0, n1 - n0), k = Math.max(1, Math.ceil(L / 150));
      for (let j = 0; j < k; j++) { const a = (j + 0.5) / k; flat(g, e0 + (e1 - e0) * a, n0 + (n1 - n0) * a, width, L / k + 1, mat, y, -Math.atan2(e1 - e0, n1 - n0)); }
    }
  }
  const mscG = new THREE.Group(), dtnG = new THREE.Group(); scene.add(mscG, dtnG);
  {
    // Manned Spacecraft Center as of 1969, simplified and approximate; Building 30 (Mission Control) at the origin
    const B = [[0, 0, 55, 45, 20, matBlank], [0, 42, 95, 18, 14, matOffice],                 // 30: windowless MOCR wing + office wing
      [-420, 60, 22, 105, 38, matOffice], [-330, -80, 60, 40, 9, matOffice], [-330, 170, 50, 40, 7, matOffice],
      [-530, 210, 20, 90, 26, matOffice], [-200, 230, 60, 50, 12, matOffice], [-120, -220, 70, 60, 14, matOffice], [-530, -150, 50, 80, 10, matOffice],
      [300, 260, 140, 90, 26, matHangar], [150, -200, 60, 40, 12, matOffice], [-660, 20, 25, 100, 18, matOffice], [-200, -330, 60, 60, 10, matOffice],
      [-660, 220, 25, 80, 18, matOffice], [560, -250, 70, 60, 36, matBlank], [120, 130, 70, 50, 10, matOffice], [350, -30, 120, 60, 12, matOffice],
      [-460, 390, 40, 80, 14, matOffice], [-50, 380, 80, 40, 9, matOffice], [700, 80, 90, 70, 16, matHangar], [-820, 120, 40, 120, 12, matOffice]];
    for (const [e, n, w, d, h, m] of B) bldg(mscG, e, n, w, d, h, m);
    const pond = new THREE.Mesh(new THREE.CircleGeometry(1, 40), matPond); pond.rotation.x = -Math.PI / 2; pond.scale.set(36 * mm, 18 * mm, 1); pond.position.set(-300 * mm, 0.4 * mm, -40 * mm); mscG.add(pond);
    for (const [e, n, w, d] of [[-150, 470, 320, 110], [620, 180, 180, 160], [-850, -220, 150, 260], [180, -380, 220, 90], [-620, 470, 160, 90]]) flat(mscG, e, n, w, d, matAsphalt);
    for (const [e, n, w, d] of [[0, 760, 2600, 22], [-950, 0, 18, 1500], [200, -470, 1900, 14], [-250, 300, 1000, 12], [450, 0, 12, 900], [-250, -40, 14, 600]]) flat(mscG, e, n, w, d, matRoad, 0.25);
  }
  {
    // downtown Houston skyline in 1969: Humble Building (185 m, tallest until 1970), Tenneco (153 m), Gulf Building (131 m), Niels Esperson, ...
    const T0 = [[260, -260, 60, 36, 185], [90, -90, 40, 40, 153], [170, 160, 45, 40, 92], [230, 120, 34, 34, 125], [0, 0, 40, 40, 125], [-380, 110, 40, 40, 125],
      [300, 330, 30, 30, 99], [-120, 260, 40, 30, 112], [-240, -180, 36, 36, 118], [380, 40, 35, 35, 103], [-60, -330, 40, 30, 107], [120, 420, 30, 30, 96]];
    const rot = -0.62;
    for (const [e, n, w, d, h] of T0) bldg(dtnG, e * Math.cos(rot) - n * Math.sin(rot), e * Math.sin(rot) + n * Math.cos(rot), w, d, h, matTower, rot);
    const gb = T0[2]; bldg(dtnG, gb[0] * Math.cos(rot) - gb[1] * Math.sin(rot), gb[0] * Math.sin(rot) + gb[1] * Math.cos(rot), 30, 28, 131, matTower, rot); // Gulf Building's setback tower
    let seed = 5; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 70; i++) {
      const e = (Math.floor(rnd() * 14) - 7) * 95 + 20, n = (Math.floor(rnd() * 14) - 7) * 95 - 20, h = 12 + Math.pow(rnd(), 2.2) * 80;
      if (T0.some((b) => Math.hypot(b[0] - e, b[1] - n) < 60)) continue;
      bldg(dtnG, e * Math.cos(rot) - n * Math.sin(rot), e * Math.sin(rot) + n * Math.cos(rot), 30 + rnd() * 40, 30 + rnd() * 40, h, h > 40 ? matTower : matOffice, rot);
    }
  }
  // ---------------- Kennedy Space Center, Launch Complex 39, as of July 1969 (origin: Pad 39A) ----------------
  const kscG = new THREE.Group(); scene.add(kscG);
  const KSCLL = (lat, lon) => { const v = kmEN(lat, lon, KSC); return [v.x * 1000, v.y * 1000]; };
  const KSCP = { vab: [28.58639, -80.65139], lcc: [28.5842, -80.6488], pad39b: [28.6272, -80.6208], oc: [28.5223, -80.6505], lc34: [28.5218, -80.5612], basin: [28.5818, -80.6512] };
  {
    // VAB: 158 m east-west x 218 m north-south; 160 m high bay at the north end, 64 m low bay to the south (no flag until 1976)
    const vc = document.createElement('canvas'); vc.width = 64; vc.height = 64; const vg = vc.getContext('2d');
    vg.fillStyle = '#cfd1d0'; vg.fillRect(0, 0, 64, 64); for (let x = 0; x < 64; x += 8) { vg.fillStyle = x % 16 ? '#bfc2c3' : '#b1b5b8'; vg.fillRect(x, 0, 3, 64); }
    const vt = new THREE.CanvasTexture(vc); vt.wrapS = vt.wrapT = THREE.RepeatWrapping;
    const matVAB = new THREE.MeshStandardMaterial({ map: vt, roughness: 0.85 });
    const [ve, vn] = KSCLL(...KSCP.vab);
    const hb = bldg(kscG, ve, vn + 42, 158, 134, 160, matVAB), lb = bldg(kscG, ve, vn - 67, 158, 84, 64, matVAB);
    for (const m of [hb, lb]) { const uv = m.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6, uv.getY(i)); }
    // high-bay door slots, east and west faces
    const matDoor = new THREE.MeshStandardMaterial({ color: 0x9da3a8, roughness: 0.9 });
    for (const sx of [-1, 1]) for (const dn of [-30, 30]) bldg(kscG, ve + sx * 79.5, vn + 42 + dn, 1.5, 26, 139, matDoor);
    const [le, ln] = KSCLL(...KSCP.lcc); bldg(kscG, le, ln, 115, 55, 23, matOffice);      // Launch Control Center, firing-room windows toward the pads
    const [be, bn] = KSCLL(...KSCP.basin); flat(kscG, be, bn, 420, 300, matPond, 0.35); strip(kscG, [[be - 60, bn - 150], [be - 60, bn - 2600]], 90, matPond, 0.35);   // turning basin & barge canal
    // crawlerway: two lanes of river rock with a grass median, from the VAB to both pads
    const matRock = new THREE.MeshStandardMaterial({ color: 0xb9b5aa, roughness: 1 });
    const cw = [[28.5866, -80.6488], [28.5935, -80.6340], [28.6012, -80.6250]].map((p) => KSCLL(...p));
    const toA = [cw[2], KSCLL(28.6072, -80.6070)], toB = [cw[2], KSCLL(28.6200, -80.6245), KSCLL(28.6262, -80.6214)];
    for (const path of [cw, toA, toB]) strip(kscG, path, 40, matRock, 0.3);
    // Pad 39B (Apollo 10 had launched from it in May): hardstand, flame trench, fixed service structures
    const [pbE, pbN] = KSCLL(...KSCP.pad39b);
    const hard = new THREE.Mesh(new THREE.CylinderGeometry(160 * mm, 160 * mm, 2 * mm, 8), matRoad); hard.position.set(pbE * mm, (1 - (pbE * pbE + pbN * pbN) / 1.2756e7) * mm, -pbN * mm); kscG.add(hard);
    bldg(kscG, pbE, pbN, 14, 120, 3, matAsphalt); bldg(kscG, pbE + 40, pbN, 20, 30, 12, matBlank);
    // Operations & Checkout Building in the industrial area, where the crew lived and suited up
    const [oe, on] = KSCLL(...KSCP.oc); bldg(kscG, oe, on, 180, 60, 20, matOffice); bldg(kscG, oe + 120, on, 60, 50, 32, matBlank);
    for (const [e, n, w, d, h] of [[-280, 120, 60, 40, 10], [-260, -150, 80, 50, 14], [150, 140, 50, 30, 8], [-420, 0, 40, 90, 12]]) bldg(kscG, oe + e, on + n, w, d, h, matOffice);
    // Launch Complex 34 on Cape Kennedy, where Apollo 1 burned and Apollo 7 launched: hardstand and launch pedestal
    const [ce, cn] = KSCLL(...KSCP.lc34); const c34 = new THREE.Mesh(new THREE.CylinderGeometry(110 * mm, 110 * mm, 2 * mm, 32), matRoad); c34.position.set(ce * mm, (1 - (ce * ce + cn * cn) / 1.2756e7) * mm, -cn * mm); kscG.add(c34);
    bldg(kscG, ce, cn, 16, 16, 9, matBlank); bldg(kscG, ce + 60, cn + 20, 14, 14, 95, matHangar);
  }
  const KSCL = [['vab', 'Vehicle Assembly Building', ...KSCP.vab, 175, 'site', 0.3, 60], ['lcc', 'Launch Control Center', ...KSCP.lcc, 30, 'body', 0.3, 12],
    ['p39a', 'Pad 39A · Apollo 11', KSC.lat, KSC.lon, 140, 'site', 0.6, 60], ['p39b', 'Pad 39B', ...KSCP.pad39b, 20, 'body', 0.5, 25],
    ['crw', 'Crawlerway', 28.5965, -80.6305, 10, 'body', 0.5, 12], ['oc', 'Operations & Checkout Building', ...KSCP.oc, 40, 'body', 0.5, 25],
    ['lc34', 'Launch Complex 34 · Apollo 1', ...KSCP.lc34, 30, 'body', 0.5, 25], ['brv', 'Banana River', 28.47, -80.61, 10, 'sea', 2, 80], ['irv', 'Indian River', 28.55, -80.72, 10, 'sea', 2, 80],
    ['atl', 'Atlantic Ocean', 28.55, -80.45, 10, 'sea', 3, 300], ['cape', 'Cape Kennedy', 28.47, -80.545, 10, 'geo', 4, 150]];
  function localBasis(t, ll) { const o = M.geoToECI(t, ll.lat, ll.lon, 0), up = unit(o), east = unit(cross([0, 0, 1], up)), north = cross(up, east); return { o, up, east, north }; }
  function placeLocal(g, t, ll) { const b = localBasis(t, ll); g.position.copy(toV3(b.o)); basisTmp.makeBasis(dirV3(b.east), dirV3(b.up), dirV3(mul(b.north, -1))); g.quaternion.setFromRotationMatrix(basisTmp); return b; }
  // [name, lat, lon, highest camera altitude (km) at which it is labelled]: major cities from far out, the rest closer in
  const GEO = [['Houston', 29.76, -95.37, 45000], ['New Orleans', 29.95, -90.07, 9000], ['Dallas', 32.78, -96.80, 9000], ['San Antonio', 29.42, -98.49, 6000], ['Corpus Christi', 27.80, -97.40, 4000],
    ['Tampa', 27.95, -82.46, 6000], ['Miami', 25.76, -80.19, 45000], ['Atlanta', 33.75, -84.39, 9000], ['Havana', 23.11, -82.37, 9000], ['Monterrey', 25.69, -100.32, 6000], ['Washington', 38.90, -77.04, 45000], ['Honolulu', 21.31, -157.86, 45000]];
  const SEAS = [['Gulf of Mexico', 25.3, -90.5], ['Atlantic Ocean', 30, -65], ['Pacific Ocean', 18, -140], ['Caribbean Sea', 15.5, -75]];
  const HOU = [['mcc', 'Mission Control · Building 30', MSC.lat, MSC.lon, 45, 'site', 0, 4], ['lrl', 'Lunar Receiving Laboratory', MSC.lat - 0.0003, MSC.lon + 0.0036, 25, 'body', 0, 3],
    ['b1', 'Building 1 · MSC headquarters', MSC.lat + 0.0005, MSC.lon - 0.0044, 50, 'body', 0, 3], ['msc', 'Manned Spacecraft Center', MSC.lat, MSC.lon, 60, 'site', 4, 60],
    ['dtn', 'Downtown Houston', DTN.lat, DTN.lon, 230, 'site', 0, 150], ['clk', 'Clear Lake', 29.5515, -95.045, 20, 'sea', 0, 40], ['gbay', 'Galveston Bay', 29.50, -94.85, 20, 'sea', 2, 200],
    ['galv', 'Galveston', 29.30, -94.80, 20, 'geo', 3, 250], ['gom', 'Gulf of Mexico', 29.05, -94.55, 20, 'sea', 5, 400]];
  const footIdx = (t) => { let lo = 0, hi = FOOT.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (FOOT[mid].t <= t) lo = mid + 1; else hi = mid; } return lo; };
  function placeAstro(obj, keys, t, phase) {
    const p = EVA.at(keys, t); obj.visible = !!p && t >= EVA.hatchOpen && t <= EVA.hatchClose + 1;
    if (!obj.visible) return null;
    let h = p.h; const moving = p.speed > 0.02 && p.h < 0.05;
    if (moving) h += 0.22 * Math.abs(Math.sin(Math.PI * (t * 1.15 + phase)));
    obj.position.set(p.e * mm, h * mm, -p.n * mm);
    if (p.h > 0.05) obj.rotation.y = Math.PI / 2; else if (moving) obj.rotation.y = Math.atan2(p.ve, -p.vn);
    obj.userData.legs.forEach((l, i) => (l.rotation.x = moving ? Math.sin(Math.PI * 2 * (t * 1.15 + phase)) * 0.35 * (i ? 1 : -1) : 0));
    return p;
  }
  const padM = new THREE.Group(); {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.002, 8), new THREE.MeshStandardMaterial({ color: 0x8a8781, roughness: 1 })); pad.position.y = 0.001; padM.add(pad);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.122, 0.012), new THREE.MeshStandardMaterial({ color: 0x9b3b2b, roughness: 0.8 })); tower.position.set(0.02, 0.061, 0); padM.add(tower);
  } scene.add(padM);

  // ---------------- trajectory lines ----------------
  function lineMat(color, dimAlpha) {
    return new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uC: { value: new THREE.Color(color) }, uDim: { value: dimAlpha }, uRot: { value: 0 }, uWrap: { value: 0 }, uTi: { value: 0 }, uW: { value: W_E } }, transparent: true, depthWrite: false,
      vertexShader: `#include <common>
      #include <logdepthbuf_pars_vertex>
      // uRot: the ascent part of the track turns with the Earth, so it stays drawn from Pad 39A; it blends into the
      // inertial (non-rotating) parking orbit over the 15 minutes after orbit insertion
      uniform float uRot, uWrap, uTi, uW;
      attribute float aT; varying float vT; void main(){ vT=aT; vec3 p=position;
        if(uRot>0.5){ float g=1.0-smoothstep(uTi,uTi+900.0,aT), a=g*(uWrap+uW*(uTi-aT)), c=cos(a), s=sin(a); p=vec3(p.x*c+p.z*s, p.y, -p.x*s+p.z*c); }
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
      #include <logdepthbuf_vertex>
      }`,
      fragmentShader: `#include <logdepthbuf_pars_fragment>
      uniform float uT; uniform vec3 uC; uniform float uDim; varying float vT;
      void main(){ float past=step(vT,uT); gl_FragColor=vec4(uC, mix(uDim,0.95,past));
      #include <logdepthbuf_fragment>
      }`,
    });
  }
  function buildLine(track, t0, t1, rel, color, dim, maxStep) {
    const pts = [], ts = []; let last = -1e9;
    for (let i = 0; i < track.t.length; i++) {
      const t = track.t[i]; if (t < t0 || t > t1) continue;
      if (t - last < (t < 900 ? 3 : (maxStep || 30)) && i < track.t.length - 1) continue; last = t;
      const s = track.sample(i), p = sub(s.p, rel(t)); pts.push(p[0], p[2], -p[1]); ts.push(t);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.setAttribute('aT', new THREE.Float32BufferAttribute(ts, 1));
    const ln = new THREE.Line(g, lineMat(color, dim)); ln.frustumCulled = false; scene.add(ln); return ln;
  }
  const css = getComputedStyle(document.documentElement);
  const cCSM = css.getPropertyValue('--csm').trim() || '#9ec8ff', cLM = css.getPropertyValue('--lm').trim() || '#f2b33d';
  const zero = () => [0, 0, 0];
  const lunarA = tLoi1 - 9 * 3600, lunarB = tTei + 9 * 3600;
  const linesE = [buildLine(S, 0, lunarA, zero, cCSM, 0.22, 20), buildLine(S, lunarB, tSplash, zero, cCSM, 0.22, 20)];
  const linesM = [buildLine(S, lunarA - 3600 * 6, lunarB + 3600 * 6, M.moonPos, cCSM, 0.18, 8), buildLine(L, T.undock, tTouch + 1, M.moonPos, cLM, 0.25, 2), buildLine(L, tLift, T.lmJett + 4 * 3600, M.moonPos, cLM, 0.25, 4)];
  const moonOrbit = (() => {
    const pts = []; for (let i = 0; i <= 400; i++) { const t = -14 * 86400 + i * 28 * 86400 / 400, p = C.moonEph(t); pts.push(p[0], p[2], -p[1]); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x3a4658, transparent: true, opacity: 0.6 })); l.frustumCulled = false; scene.add(l); return l;
  })();

  // ---------------- state helpers ----------------
  function stackState(t) {
    if (t <= 0) { const p = M.geoToECI(t, KSC.lat, KSC.lon, 0); return { p, v: cross([0, 0, W_E], p), m: 2.938e6 }; }
    if (t >= tSplash) { const p = M.geoToECI(t, splashLL.lat, splashLL.lon, 0); return { p, v: cross([0, 0, W_E], p), m: S.at(tSplash).m }; }
    return S.at(t);
  }
  const accelOf = (stateFn, t) => {
    const h = 0.5, a = stateFn(t - h), b = stateFn(t + h), s = stateFn(t);
    if (!a || !b || !s) return [0, 0, 0];
    return sub(mul(sub(b.v, a.v), 1 / (2 * h)), M.grav(t, s.p));
  };
  const lmState = (t) => (t >= T.undock && t <= L.t1) ? L.at(t) : null;
  const central = (p, t) => (norm(sub(p, M.moonPos(t))) < 66100 ? 'moon' : 'earth');
  const qTmp = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0);
  function orient(obj, dirECI, mode) { qTmp.setFromUnitVectors(yAxis, dirV3(unit(dirECI)).normalize()); obj.quaternion.slerp(qTmp, mode === 'snap' ? 1 : 0.25); }
  const lastAtt = { csm: [0, 0, 1], lm: [0, 0, 1] };

  // ---------------- attitude as a pure function of time ----------------
  // Every turn (slews before and after burns, transposition, CM turnaround, docking) is computed from
  // GET, so it animates at 1x and stays consistent after a jump or at high warp.
  const s3 = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  const qOf = (d) => new THREE.Quaternion().setFromUnitVectors(yAxis, dirV3(unit(d)).normalize());
  const flipX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  const qSl = (a, b, u) => a.clone().slerp(b, Math.max(0, Math.min(1, u)));
  const toECI = (v) => [v.x, -v.z, v.y];
  function burnList(fn, a, b, step) {
    const out = []; let cur = null;
    for (let t = a; t <= b; t += step) if (norm(accelOf(fn, t)) > 0.25e-3) { if (cur && t - cur.e <= 30) cur.e = t; else out.push(cur = { s: t, e: t }); }
    return out;
  }
  const BURN_CSM = burnList(stackState, T.lmExtract + 60, T.cmSep - 10, 4);
  const BURN_LM = burnList(lmState, T.undock + 5, T.docking - 5, 2);
  // slew to the burn attitude in the 5 minutes before ignition, back to coast attitude after;
  // burns less than ~an hour apart hold attitude in between (as DOI to PDI did)
  function schedQ(list, fn, t, coastQ) {
    const thrQ = (tt) => { const a = accelOf(fn, tt); return norm(a) > 1e-5 ? qOf(a) : coastQ(tt); };
    let prev = null, next = null;
    for (const b of list) { if (t >= b.s && t <= b.e) return thrQ(t); if (b.e < t) prev = b; else if (!next) next = b; }
    const pe = prev && thrQ(prev.e - 1), ns = next && thrQ(Math.min(next.s + 3, next.e));
    if (prev && next && next.s - prev.e < 4000) return qSl(pe, ns, s3((t - prev.e - 60) / Math.max(1, next.s - prev.e - 120)));
    let q = coastQ(t);
    if (next && t > next.s - 300) q = qSl(q, ns, s3((t - next.s + 300) / 240));
    if (prev && t < prev.e + 300) q = qSl(pe, q, s3((t - prev.e - 60) / 240));
    return q;
  }
  const csmCoast = (t) => { const s = stackState(t); return qOf(central(s.p, t) === 'moon' ? sub(s.v, M.moonVel(t)) : s.v); };
  const lmCoast = (t) => { const s = lmState(t); return s ? qOf(sub(s.v, M.moonVel(t))) : new THREE.Quaternion(); };
  const n0At = (t) => unit(stackState(t).v);
  // Transposition & docking, seconds after separation: back out 15 m, pitch 180°, close in and dock
  const TD = { out: 90, turn: 270, dock: 420 };
  const relCSM = (tau) => tau < TD.out ? 27.2 + 15 * s3(tau / TD.out) : tau < TD.turn ? 42.2 : 42.2 - 5.5 * s3((tau - TD.turn) / (TD.dock - TD.turn));
  // the docked stack drifts imperceptibly so that Columbia sits on its trajectory point at extraction
  const shiftAt = (t) => -41.7 * s3((t - T.tde - TD.dock) / (T.lmExtract - T.tde - TD.dock));
  const sivbBase = (t) => add(stackState(t).p, mul(n0At(t), (5 + shiftAt(t)) / 1000));
  const csmVis = (t) => (t < T.tde || t >= T.lmExtract) ? stackState(t).p : add(sivbBase(t), mul(n0At(t), relCSM(t - T.tde) / 1000));
  let SIVB_C = null;
  const sivbC = () => SIVB_C || (SIVB_C = sub(sivbBase(T.lmExtract), SV.at(T.lmExtract).p));
  const cqC = { t: NaN, q: null }, lqC = { t: NaN, q: null };
  function csmQuat(t) {
    if (cqC.t === t) return cqC.q;
    let q;
    if (t < T.tde) q = qOf(stackState(t).v);
    else if (t < T.lmExtract) { const q0 = qOf(n0At(t)); q = qSl(q0, q0.clone().multiply(flipX), s3((t - T.tde - TD.out) / (TD.turn - TD.out))); }
    else if (t < T.cmSep) {
      q = schedQ(BURN_CSM, stackState, t, csmCoast);
      // after extraction the docked pair turns from facing the S-IVB to its cruise attitude
      if (t < T.lmExtract + 720) q = qSl(qOf(n0At(t)).multiply(flipX), q, s3((t - T.lmExtract - 300) / 420));
    } else {
      const s = stackState(t), up = qOf(s.p);
      if (t >= tSplash) q = up;
      else {
        // Command Module turns its heat shield forward after shedding the Service Module
        const vrel = sub(s.v, cross([0, 0, W_E], s.p)), shield = qOf(mul(vrel, -1));
        q = qSl(qOf(s.v), shield, s3((t - T.cmSep - 60) / 240));
        if (tDrogue && t >= tDrogue) q = qSl(shield, up, s3((t - tDrogue) / 12));
      }
    }
    cqC.t = t; cqC.q = q; return q;
  }
  function lmQuat(t) {
    if (lqC.t === t) return lqC.q;
    const q = schedQ(BURN_LM, lmState, t, lmCoast); lqC.t = t; lqC.q = q; return q;
  }
  const noseOf = (q) => toECI(new THREE.Vector3(0, 1, 0).applyQuaternion(q));

  // ---------------- transport & milestones ----------------
  let simT = tStart, playing = true, warp = 1, autoSlow = true;
  const WARPS = [1, 10, 100, 1000, 10000];
  const warpEl = $('warp');
  const warpLabel = (w) => (w >= 1000 ? (w / 1000) + 'k×' : w + '×');
  let hold = null, preWarp = null, prevT = simT;
  WARPS.forEach((w) => { const b = document.createElement('button'); b.textContent = warpLabel(w); b.dataset.w = w; b.setAttribute('aria-pressed', w === warp); b.onclick = () => userWarp(w); warpEl.appendChild(b); });
  function setWarp(w) { warp = w; warpEl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.w === w)); }
  function userWarp(w) { hold = null; preWarp = null; setWarp(w); if (!playing) togglePlay(); renderHold(); }
  const playBtn = $('play');
  function togglePlay() { playing = !playing; playBtn.textContent = playing ? 'Pause' : 'Play'; }
  playBtn.onclick = togglePlay;
  const slowBtn = $('autoslow');
  slowBtn.onchange = () => { autoSlow = slowBtn.checked; $('autoslowL').classList.toggle('off', !autoSlow); if (!autoSlow) { hold = null; preWarp = null; renderHold(); } };

  const MILES = EV.filter((e) => EDU[e.name]);
  const leadOf = (e) => (EDU[e.name] && EDU[e.name].lead != null ? EDU[e.name].lead : 10);
  const holdEnd = (e) => {
    const h = EDU[e.name] ? EDU[e.name].hold : 20;
    if (typeof h === 'string' && h.startsWith('until:')) { const t2 = evT(h.slice(6)); return (t2 != null ? t2 : e.t) + 8; }
    return e.t + (h || 20);
  };
  const evSel = $('events');
  { const o = document.createElement('option'); o.textContent = 'Jump to event…'; o.value = ''; evSel.appendChild(o); }
  MILES.forEach((e, i) => { const o = document.createElement('option'); o.value = i; o.textContent = shortGET(e.t) + '  ' + e.name; evSel.appendChild(o); });
  evSel.onchange = () => { const e = MILES[+evSel.value]; if (!e) return; jumpTo(e.t - leadOf(e) - 2); setWarp(1); if (!playing) togglePlay(); evSel.value = ''; };
  function jumpTo(t) { simT = Math.max(tStart, Math.min(tEnd, t)); prevT = simT; hold = null; preWarp = null; renderHold(); for (const a of Object.values(agcs)) syncClock(a, true); showEvent(currentEvent(simT), false); }

  // step between milestones: arrive a few seconds before each one, at 1x
  const startOf = (e) => e.t - leadOf(e) - 2;
  $('nextM').onclick = () => { const e = MILES.find((m) => startOf(m) > simT + 1); if (e) { jumpTo(startOf(e)); setWarp(1); if (!playing) togglePlay(); } };
  $('prevM').onclick = () => { const list = MILES.filter((m) => startOf(m) < simT - 4); const e = list[list.length - 1]; jumpTo(e ? startOf(e) : tStart); setWarp(1); if (!playing) togglePlay(); };
  const logEl = $('log');
  const logItems = MILES.map((e) => {
    const b = document.createElement('button'); b.className = 'log-item'; b.innerHTML = `<span class="lt">${shortGET(e.t)}</span><span class="ln">${e.name}</span>`;
    b.onclick = () => { jumpTo(e.t - leadOf(e) - 2); setWarp(1); if (!playing) togglePlay(); };
    logEl.appendChild(b); return { e, b };
  });

  const tlEl = $('timeline');
  tlEl.innerHTML = '<div class="track"></div><div class="fill"></div><div class="head"></div>';
  const span = tEnd - tStart, xOf = (t) => ((t - tStart) / span) * 100;
  const majors = new Set(['Liftoff', 'TLI ignition', 'LOI-1', 'Touchdown', 'Lunar liftoff', 'TEI', 'Splashdown']);
  MILES.forEach((e) => { const d = document.createElement('div'); d.className = 'tick' + (majors.has(e.name) ? ' major' : ''); d.style.left = xOf(e.t) + '%'; d.title = e.name; tlEl.appendChild(d); });
  [0, 48, 96, 144, 192].forEach((h) => { const d = document.createElement('div'); d.className = 'scale'; d.style.left = xOf(h * 3600) + '%'; d.textContent = h + 'h'; tlEl.appendChild(d); });
  const scrub = (ev) => { const r = tlEl.getBoundingClientRect(); const u = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)); jumpTo(tStart + u * span); };
  let dragging = false;
  tlEl.addEventListener('pointerdown', (e) => { dragging = true; tlEl.setPointerCapture(e.pointerId); scrub(e); });
  tlEl.addEventListener('pointermove', (e) => { if (dragging) scrub(e); });
  tlEl.addEventListener('pointerup', () => { dragging = false; });
  tlEl.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') jumpTo(simT + 600); if (e.key === 'ArrowLeft') jumpTo(simT - 600); });

  const phaseLabel = { launch: 'Launch', 'earth-orbit': 'Earth parking orbit', tli: 'Trans-lunar injection', translunar: 'Trans-lunar coast', loi: 'Lunar orbit insertion', 'lunar-orbit': 'Lunar orbit', descent: 'Powered descent', surface: 'Tranquility Base', ascent: 'Lunar ascent', rendezvous: 'Rendezvous', transearth: 'Trans-Earth coast', entry: 'Entry', recovery: 'Recovery' };
  const card = $('evCard'), cardMore = $('evMore'), cardToggle = $('evToggle');
  let shownEvent = null;
  const narrow = () => window.matchMedia('(max-width: 900px)').matches;
  let moreOpen = !narrow();
  function setMore(open) { moreOpen = open; cardMore.hidden = !open; cardToggle.textContent = open ? 'Hide details' : 'Why it mattered'; cardToggle.setAttribute('aria-expanded', open); }
  cardToggle.onclick = () => setMore(!moreOpen);
  setMore(moreOpen);
  function currentEvent(t) { let cur = null; for (const e of MILES) if (e.t <= t) cur = e; return cur; }
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  function showEvent(e, flash) {
    if (!e) { shownEvent = null; return; }
    if (shownEvent === e && !flash) return;
    shownEvent = e;
    const ed = EDU[e.name] || {};
    $('evPhase').textContent = (phaseLabel[e.phase] || '') + ' · GET ' + shortGET(e.t);
    $('evTitle').textContent = e.name;
    $('evDesc').textContent = ed.why || e.desc;
    const facts = (ed.facts || []).slice(); if (SIMFACT[e.name]) facts.push(SIMFACT[e.name]());
    $('evFacts').innerHTML = facts.map((f) => `<li>${esc(f)}</li>`).join('');
    cardToggle.hidden = !facts.length && !ed.dsky;
    const tryBtn = $('evTry');
    if (ed.dsky) { tryBtn.hidden = false; tryBtn.textContent = (ed.dsky.agc === 'lm' ? 'Try it on the LGC: ' : 'Try it on the CMC: ') + ed.dsky.label; tryBtn.onclick = () => { selectAGC(ed.dsky.agc); typing = { keys: ed.dsky.keys.slice(), next: 0 }; if (narrow()) $('dsky').scrollIntoView({ behavior: 'smooth', block: 'center' }); }; }
    else tryBtn.hidden = true;
    if (flash) { card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash'); }
    logItems.forEach(({ e: x, b }) => b.classList.toggle('current', x === e));
    if (cmdFor !== e) renderCmd(e);
  }
  function renderHold() {
    const el = $('evHold');
    if (hold && hold.resume) { el.hidden = false; $('evHoldText').textContent = `Slowed to 1× for this milestone. Back to ${warpLabel(hold.resume)} at ${shortGET(hold.until)}.`; $('evResume').textContent = warpLabel(hold.resume) + ' now'; }
    else el.hidden = true;
  }
  $('evResume').onclick = () => { if (hold && hold.resume) userWarp(hold.resume); };
  $('evStay').onclick = () => { hold = null; preWarp = null; renderHold(); };

  let view = 'craft', followPref = 'auto';
  const VIEW_DIST = { earth: 26000, moon: 7500, overview: 9e5, houston: 2.6, ksc: 9 };
  let trans = null, rendered = false;
  document.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => setView(b.dataset.view)));
  function setView(v) {
    // remember where the camera was so drawPane can fly from there to the new view
    if (rendered && view !== 'split' && v !== 'split') trans = { from: view === 'craft' ? 'craft' : view, who: lastWho, A: { el: cam.el, az: cam.az, dist: cam.dist, U: cam.U.clone(), E: cam.E.clone(), N: cam.N.clone() }, dur: 0, s: 0 };
    else trans = null;
    view = v; document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.view === v));
    if (v === 'split') { cam.dist = cam.distGoal = craftDist('csm'); camB.dist = camB.distGoal = craftDist('lm'); cam.snap = camB.snap = true; cam.el = camB.el = 0.32; cam.az = camB.az = 0.9; return; }
    cam.dist = cam.distGoal = v === 'craft' ? craftDist() : VIEW_DIST[v]; cam.snap = true;
    if (v === 'houston') { cam.el = 0.3; cam.az = -0.75; cam.snap = true; }
    else if (v === 'ksc') { cam.el = 0.32; cam.az = -2.5; cam.snap = true; }
    else if (v === 'overview') { cam.el = 1.2; cam.az = -1.2; } else if (v === 'craft') { cam.el = craftEl(simT); cam.elGoal = null; cam.az = simT < 600 ? 0.25 : 0.9; } else { cam.el = 0.35; cam.az = 0.6; }
  }
  // default camera elevation for the spacecraft view; on the way home look down past Columbia at the approaching Earth
  function craftEl(t) { return t < 600 ? 0.1 : (t > tEI - 6 * 3600 && t < tEI - 90) ? 1.3 : 0.32; }
  let elKey = null, lastWho = 'csm';
  const splitChip = document.querySelector('[data-view="split"]');
  const followEl = $('follow');
  followEl.onclick = () => { followPref = followed() === 'lm' ? 'csm' : 'lm'; setView('craft'); };
  function followed() {
    const lmOwn = simT >= T.undock && simT < T.docking;
    if (followPref === 'lm' && lmOwn) return 'lm'; if (followPref === 'csm') return 'csm';
    return (simT >= T.undock + 300 && simT < T.docking) ? 'lm' : 'csm';
  }
  function craftDist(w) { if (simT < T.siiCutoff) return 0.42; if (simT < T.tde) return 0.12; if (simT < T.lmExtract) return 0.11; if ((w || followed()) === 'lm') return simT > EVA.hatchOpen && simT < EVA.hatchClose ? 0.045 : 0.035; if (simT > tMain) return 0.13; if (simT > tDrogue) return 0.09; if (simT > T.cmSep) return 0.045; if (simT < T.undock || (simT >= T.docking && simT < T.lmJett)) return 0.075; return 0.06; }

  // ---------------- DSKY ----------------
  const SEGS = { a: '2,1 13,1 11,3 4,3', b: '13.5,1.5 13.5,11.5 12,12.5 11.5,3.5', c: '13.5,12.5 13.5,23 11.5,21 12,13.5', d: '2,23.5 13,23.5 11,21.5 4,21.5', e: '1.5,12.5 3.5,13.5 3.5,21 1.5,23', f: '1.5,1.5 3.5,3.5 3.5,11.5 1.5,11.5', g: '3,12 12,12 13,12.5 12,13 3,13 2,12.5' };
  const DIG = { ' ': '', '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcfgd' };
  function digitSVG(sign) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 15 25'); s.setAttribute('class', 'd' + (sign ? ' s' : ''));
    const segs = sign ? { g: SEGS.g, v1: '7,4.5 8,4.5 8,11 7,11', v2: '7,14 8,14 8,20.5 7,20.5' } : SEGS;
    const map = {}; for (const [k, pts] of Object.entries(segs)) { const p = document.createElementNS('http://www.w3.org/2000/svg', 'polygon'); p.setAttribute('points', pts); s.appendChild(p); map[k] = p; }
    s._cur = null;
    s.set = (ch) => {
      if (s._cur === ch) return; s._cur = ch;
      if (sign) { const plus = ch === '+', minus = ch === '-'; map.g.classList.toggle('on', plus || minus); map.v1.classList.toggle('on', plus); map.v2.classList.toggle('on', plus); return; }
      const on = DIG[ch] || ''; for (const k in map) map[k].classList.toggle('on', on.includes(k));
    };
    return s;
  }
  const LAMPS_CM = [['UPLINK<br>ACTY', 'uplink', 'w'], ['NO ATT', 'noAtt', 'w'], ['STBY', 'stby', 'w'], ['KEY REL', 'keyRel', 'w'], ['OPR ERR', 'oprErr', 'w'], ['', null], ['', null], ['TEMP', 'temp', 'y'], ['GIMBAL<br>LOCK', 'gimbalLock', 'y'], ['PROG', 'prog', 'y'], ['RESTART', 'restart', 'y'], ['TRACKER', 'tracker', 'y'], ['', null], ['', null]];
  const LAMPS_LM = [['UPLINK<br>ACTY', 'uplink', 'w'], ['NO ATT', 'noAtt', 'w'], ['STBY', 'stby', 'w'], ['KEY REL', 'keyRel', 'w'], ['OPR ERR', 'oprErr', 'w'], ['PRIO<br>DISP', 'prioDisp', 'w'], ['NO DAP', 'noDap', 'w'], ['TEMP', 'temp', 'y'], ['GIMBAL<br>LOCK', 'gimbalLock', 'y'], ['PROG', 'prog', 'y'], ['RESTART', 'restart', 'y'], ['TRACKER', 'tracker', 'y'], ['ALT', 'alt', 'y'], ['VEL', 'vel', 'y']];
  const dskyEl = $('dsky');
  let which = 'cm'; const D = {};
  function buildDSKY() {
    dskyEl.innerHTML = '';
    const top = document.createElement('div'); top.className = 'dsky-top';
    const lamps = document.createElement('div'); lamps.className = 'lamps';
    const spec = which === 'cm' ? LAMPS_CM : LAMPS_LM; D.lamps = [];
    for (let r = 0; r < 7; r++) for (const col of [0, 1]) { const [txt, key, colr] = spec[col * 7 + r]; const d = document.createElement('div'); d.className = 'lamp' + (key ? '' : ' blank'); d.innerHTML = txt || '&nbsp;'; lamps.appendChild(d); if (key) D.lamps.push([d, key, colr]); }
    const disp = document.createElement('div'); disp.className = 'disp';
    const mkField = (label, n) => { const f = document.createElement('div'); f.className = 'field'; const l = document.createElement('div'); l.className = 'dlab'; l.textContent = label; const ds = document.createElement('div'); ds.className = 'digits'; const digs = []; for (let i = 0; i < n; i++) { const g = digitSVG(false); ds.appendChild(g); digs.push(g); } f.append(l, ds); return { f, digs }; };
    const row1 = document.createElement('div'); row1.className = 'drow';
    const acty = document.createElement('div'); acty.className = 'dlab acty'; acty.innerHTML = 'COMP<br>ACTY'; D.acty = acty;
    const prog = mkField('PROG', 2); row1.append(acty, prog.f);
    const row2 = document.createElement('div'); row2.className = 'drow';
    const verb = mkField('VERB', 2), noun = mkField('NOUN', 2); row2.append(verb.f, noun.f);
    D.prog = prog.digs; D.verb = verb.digs; D.noun = noun.digs; D.reg = [];
    disp.append(row1, row2);
    for (let i = 0; i < 3; i++) {
      const sep = document.createElement('div'); sep.className = 'sep'; disp.appendChild(sep);
      const r = document.createElement('div'); r.className = 'drow'; r.style.justifyContent = 'flex-end';
      const ds = document.createElement('div'); ds.className = 'digits'; const sg = digitSVG(true); ds.appendChild(sg); const digs = [sg]; for (let k = 0; k < 5; k++) { const g = digitSVG(false); ds.appendChild(g); digs.push(g); }
      r.appendChild(ds); disp.appendChild(r); D.reg.push(digs);
    }
    top.append(lamps, disp);
    const keys = document.createElement('div'); keys.className = 'keys';
    const K = [['VERB', 1, 2, 3, 'small'], ['NOUN', 1, 4, 5, 'small'], ['+', 2, 1, 2], ['-', 2, 3, 4, '', '−'], ['0', 2, 5, 6], ['7', 3, 1, 2], ['4', 3, 3, 4], ['1', 3, 5, 6], ['8', 4, 1, 2], ['5', 4, 3, 4], ['2', 4, 5, 6], ['9', 5, 1, 2], ['6', 5, 3, 4], ['3', 5, 5, 6], ['CLR', 6, 1, 2, 'small'], ['PRO', 6, 3, 4, 'small'], ['KEYREL', 6, 5, 6, 'small', 'KEY REL'], ['ENTR', 7, 2, 3, 'small'], ['RSET', 7, 4, 5, 'small']];
    D.keyEls = {};
    for (const [k, c, r0, r1, cls, txt] of K) {
      const b = document.createElement('button'); b.className = 'key ' + (cls || ''); b.textContent = txt || k; b.style.gridColumn = c; b.style.gridRow = `${r0} / ${r1 + 1}`; b.setAttribute('aria-label', txt || k);
      if (k === 'PRO') { b.addEventListener('pointerdown', (e) => { e.preventDefault(); agcs[which].pro(true); b.classList.add('down'); }); const up = () => { agcs[which].pro(false); b.classList.remove('down'); }; b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); }
      else b.addEventListener('click', () => press(k));
      keys.appendChild(b); D.keyEls[k] = b;
    }
    dskyEl.append(top, keys);
  }
  function press(k) { agcs[which].key(k); const b = D.keyEls[k]; if (b) { b.classList.add('down'); setTimeout(() => b.classList.remove('down'), 110); } }
  function renderDSKY() {
    const d = agcs[which].dsky();
    D.acty.classList.toggle('on', d.compActy);
    d.prog.split('').forEach((c, i) => D.prog[i].set(c)); d.verb.split('').forEach((c, i) => D.verb[i].set(c)); d.noun.split('').forEach((c, i) => D.noun[i].set(c));
    [d.r1, d.r2, d.r3].forEach((s, r) => s.split('').forEach((c, i) => D.reg[r][i].set(c)));
    for (const [el, key, colr] of D.lamps) { const on = !!d.lamps[key]; el.classList.toggle('on', on); el.classList.toggle(colr, on); }
  }
  const selCM = $('selCM'), selLM = $('selLM');
  function selectAGC(w) { if (which === w && D.lamps) return; which = w; selCM.setAttribute('aria-pressed', w === 'cm'); selLM.setAttribute('aria-pressed', w === 'lm'); buildDSKY(); renderDSKY(); }
  selCM.onclick = () => selectAGC('cm'); selLM.onclick = () => selectAGC('lm');
  buildDSKY();
  const keyMap = { v: 'VERB', n: 'NOUN', '+': '+', '=': '+', '-': '-', Enter: 'ENTR', e: 'ENTR', c: 'CLR', r: 'RSET', k: 'KEYREL' };
  dskyEl.addEventListener('keydown', (e) => {
    if (/^[0-9]$/.test(e.key)) { press(e.key); e.preventDefault(); return; }
    if (e.key === 'p' || e.key === 'P') { agcs[which].pro(true); e.preventDefault(); return; }
    const k = keyMap[e.key] || keyMap[e.key.toLowerCase()]; if (k) { press(k); e.preventDefault(); }
  });
  dskyEl.addEventListener('keyup', (e) => { if (e.key === 'p' || e.key === 'P') agcs[which].pro(false); });
  dskyEl.addEventListener('pointerdown', () => dskyEl.focus({ preventScroll: true }));
  const RECIPES = [['V35E', 'lamp test', ['VERB', '3', '5', 'ENTR']], ['V16N65E', 'mission clock', ['VERB', '1', '6', 'NOUN', '6', '5', 'ENTR']], ['V37E00E', 'go to P00', ['VERB', '3', '7', 'ENTR', '0', '0', 'ENTR']], ['V05N09E', 'alarm codes', ['VERB', '0', '5', 'NOUN', '0', '9', 'ENTR']], ['V06N36E', 'AGC clock', ['VERB', '0', '6', 'NOUN', '3', '6', 'ENTR']], ['RSET', 'clear lamps', ['RSET']], ['KEY REL', '', ['KEYREL']]];
  let typing = null;
  // ---------------- milestone keystrokes, typed into the real AGC ----------------
  const CMD_MAP = { V: 'VERB', N: 'NOUN', E: 'ENTR', P: 'PRO', R: 'RSET' };
  const CHIP = { VERB: 'VERB', NOUN: 'NOUN', ENTR: 'ENTR', PRO: 'PRO', RSET: 'RSET' };
  const seqKeys = (seq) => seq.split('').map((c) => CMD_MAP[c] || c);
  const cmdEl = $('evCmd'), cmdKeys = $('evCmdKeys'), cmdResp = $('evCmdResp');
  let cmdFor = null;
  function renderCmd(e) {
    const c = e && window.CMDS && CMDS[e.name];
    cmdFor = c ? e : null; cmdEl.hidden = !c; if (!c) return;
    $('evCmdWho').textContent = c.agc === 'lm' ? 'Eagle · LGC' : 'Columbia · CMC';
    cmdKeys.innerHTML = ''; cmdResp.innerHTML = '<i>' + esc(c.what) + '</i>';
    for (const k of seqKeys(c.seq)) { const b = document.createElement('span'); b.className = 'ck'; b.textContent = CHIP[k] || k; cmdKeys.appendChild(b); }
  }
  function typeCmd(e) {
    const c = window.CMDS && CMDS[e.name]; if (!c) return;
    if (cmdFor !== e) renderCmd(e);
    selectAGC(c.agc);
    [...cmdKeys.children].forEach((x) => x.classList.remove('done', 'now'));
    typing = { keys: ['RSET', ...seqKeys(c.seq)], next: 0, agc: c.agc, chip0: 1, what: c.what, at: performance.now() + 500 };
  }
  $('evCmdRe').onclick = () => { if (cmdFor) typeCmd(cmdFor); };
  function stepTyping(now) {
    const ty = typing, k = ty.keys[ty.next], a = agcs[ty.agc || which];
    if (k === 'PRO') { a.pro(true); setTimeout(() => a.pro(false), 350); }
    else a.key(k);
    if ((ty.agc || which) === which && D.keyEls[k]) { const b = D.keyEls[k]; b.classList.add('down'); setTimeout(() => b.classList.remove('down'), 140); }
    if (ty.chip0 != null) { const i = ty.next - ty.chip0, ch = cmdKeys.children; for (let j = 0; j < ch.length; j++) { ch[j].classList.toggle('done', j < i); ch[j].classList.toggle('now', j === i); } }
    ty.next++; ty.at = now + (ty.chip0 != null ? 420 : 260);
    if (ty.next >= ty.keys.length) {
      typing = null;
      if (ty.chip0 != null) setTimeout(() => {
        [...cmdKeys.children].forEach((x) => { x.classList.remove('now'); x.classList.add('done'); });
        const d = agcs[ty.agc].dsky(), on = Object.entries(d.lamps).filter((x) => x[1]).map((x) => x[0]);
        const parts = []; if (d.prog.trim()) parts.push('PROG ' + d.prog); if (d.verb.trim()) parts.push('V' + d.verb); if (d.noun.trim()) parts.push('N' + d.noun);
        let txt = 'AGC: ' + (parts.join(' ') || 'accepted');
        if (on.includes('prog')) txt += ' · PROG lamp';
        if (on.includes('oprErr')) txt += ' · OPR ERR';
        let note = ty.what;
        if (on.includes('prog')) note = 'The real program raised an alarm because no IMU or navigation data is wired into this emulator. Key V05N09E to read the code (00210: IMU not operating).';
        cmdResp.innerHTML = esc(txt) + '<br><i>' + esc(note) + '</i>';
      }, 1200);
    }
  }
  const recEl = $('recipes');
  RECIPES.forEach(([lab, sub2, keys]) => { const b = document.createElement('button'); b.className = 'recipe'; b.innerHTML = lab + (sub2 ? `<span>${sub2}</span>` : ''); b.onclick = () => { typing = { keys: keys.slice(), next: 0 }; }; recEl.appendChild(b); });
  function syncClock(a, force) {
    const want = Math.max(0, simT), have = (a.erasable(0, 0o24) * 16384 + a.erasable(0, 0o25)) / 100;
    if (force || Math.abs(have - want) > 1.5) { const cs = Math.round(want * 100); a.x.agc_set_erasable(a.s, 0, 0o24, Math.floor(cs / 16384) & 0o37777); a.x.agc_set_erasable(a.s, 0, 0o25, cs % 16384); }
  }

  // ---------------- labels ----------------
  const labelsEl = $('labels');
  const mkLabel = (txt, cls) => { const d = document.createElement('div'); d.className = 'label ' + cls; d.textContent = txt; labelsEl.appendChild(d); return d; };
  const mkSet = () => ({ csm: mkLabel('Columbia', 'csm'), lm: mkLabel('Eagle', 'lm'), earth: mkLabel('Earth', 'body'), moon: mkLabel('Moon', 'body'), site: mkLabel('Tranquility Base', 'site'), sivb: mkLabel('S-IVB', 'body'), ksc: mkLabel('Kennedy Space Center', 'site'), splash: mkLabel('Recovery area', 'site'), arm: mkLabel('Armstrong', 'body'), ald: mkLabel('Aldrin', 'body'), lwc: mkLabel('Little West crater', 'site'), wc: mkLabel('West crater', 'site') });
  const mkGeo = (o) => { o.geo = GEO.map(([n]) => mkLabel(n, 'geo')); o.seas = SEAS.map(([n]) => mkLabel(n, 'sea')); o.hou = HOU.map((h) => mkLabel(h[1], h[5])); o.kscl = KSCL.map((h) => mkLabel(h[1], h[5])); return o; };
  const LBL2 = mkGeo(mkSet());
  const LBL = { csm: mkLabel('Columbia', 'csm'), lm: mkLabel('Eagle', 'lm'), earth: mkLabel('Earth', 'body'), moon: mkLabel('Moon', 'body'), site: mkLabel('Tranquility Base', 'site'), sivb: mkLabel('S-IVB', 'body'), ksc: mkLabel('Kennedy Space Center', 'site'), splash: mkLabel('Recovery area', 'site'), arm: mkLabel('Armstrong', 'body'), ald: mkLabel('Aldrin', 'body'), lwc: mkLabel('Little West crater', 'site'), wc: mkLabel('West crater', 'site') };
  mkGeo(LBL);
  const occluded = (camW, pW, centerW, r) => { const d = pW.clone().sub(camW), Ld = d.length(); d.normalize(); const oc = centerW.clone().sub(camW), tca = oc.dot(d); if (tca < 0) return false; const d2 = oc.lengthSq() - tca * tca; return d2 < r * r * 0.995 && tca - Math.sqrt(Math.max(0, r * r - d2)) < Ld - 0.05 - Ld * 2e-5; };  // tolerance: points on the surface itself count as visible
  function placeLabel(el, p, show, w, h, ox = 0, oy = 0) {
    if (!show) { el.hidden = true; return; }
    const v = toV3(p), camW = camera.position;
    if (occluded(camW, v, earth.position, R_E) || occluded(camW, v, moon.position, R_M)) { el.hidden = true; return; }
    v.project(camera); if (v.z > 1 || v.z < -1) { el.hidden = true; return; }
    el.hidden = false; el.style.transform = `translate(${ox + (v.x * 0.5 + 0.5) * w + 8}px, ${oy + (-v.y * 0.5 + 0.5) * h}px) translateY(-50%)`;
  }

  function resize() { const r = canvas.parentElement.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); }
  window.addEventListener('resize', resize); resize();
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas.parentElement);

  const fmtNum = (x, d = 0) => x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  let lastFrame = performance.now(), prevFollow = null, lastUI = 0;
  const els = { get: $('get'), utc: $('utc'), alt: $('tAlt'), vel: $('tVel'), de: $('tDE'), dm: $('tDM'), mass: $('tMass'), eng: $('tEng'), altK: $('altK'), velK: $('velK'), fill: tlEl.querySelector('.fill'), head: tlEl.querySelector('.head') };
  const nextMile = (t) => MILES.find((e) => e.t - leadOf(e) > t + 1e-6);

  // Time advance with automatic deceleration ahead of milestones
  function advance(dt) {
    if (!playing || dragging) return;
    let step = dt * warp;
    if (autoSlow && warp > 1) {
      const nx = nextMile(simT);
      if (nx) {
        const gap = nx.t - leadOf(nx) - simT;
        while (warp > 1 && gap < WARPS[WARPS.indexOf(warp) - 1] * 1.5) { if (!preWarp) preWarp = warp; setWarp(WARPS[WARPS.indexOf(warp) - 1]); }
        step = warp > 1 ? Math.min(dt * warp, gap) : dt;
      }
    }
    simT = Math.min(tEnd, simT + step);
    for (const e of MILES) {
      if (e.t > prevT && e.t <= simT) {
        showEvent(e, true);
        if (warp <= 10 && window.CMDS && CMDS[e.name]) typeCmd(e);
        if (autoSlow) {
          const until = holdEnd(e);
          if (hold) hold.until = Math.max(hold.until, until);
          else if (preWarp) hold = { until, resume: preWarp };
          preWarp = null; renderHold();
        }
      }
    }
    prevT = simT;
    if (hold && simT >= hold.until) { const r = hold.resume; hold = null; if (r && warp === 1) setWarp(r); renderHold(); }
  }


  let engName = 'Off', lmEng = '', splitActive = false, splitSide = true; const evaPos = { A: null, B: null };

  const smst = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  function dockBlend(t) {
    let w = 0, spin = 0;
    if (t >= T.undock && t < T.undock + 900) { w = 1 - smst((t - T.undock) / 240); spin = smst((t - T.undock - 120) / 600) * Math.PI * 2; }
    else if (t > T.docking - 420 && t < T.docking) w = smst((t - (T.docking - 420)) / 420);
    return { w, spin };
  }
  let JETT = null;
  function lmVisualPos(t, ls, st) {
    if (ls && t >= T.lmJett) { JETT = JETT || mul(noseOf(csmQuat(T.lmJett)), 17.2 / 1000); return add(ls.p, JETT); }
    const { w } = dockBlend(t); if (!ls || w <= 0) return ls ? ls.p : null;
    const pd = add(st.p, mul(noseOf(csmQuat(t)), (11.1 + 6.1) / 1000));
    return add(mul(ls.p, 1 - w), mul(pd, w));
  }
  function focusFor(pv, who, t, st, ls, mp) {
    if (pv === 'earth') return [0, 0, 0];
    if (pv === 'moon') return mp;
    if (pv === 'overview') return mul(mp, 0.5);
    if (pv === 'houston') return M.geoToECI(t, MSC.lat, MSC.lon, 0.03);
    if (pv === 'ksc') return M.geoToECI(t, 28.597, -80.628, 0.05);
    const pf = who === 'lm' && ls ? { p: lmVisualPos(t, ls, st), v: ls.v } : { p: csmVis(t), v: st.v };
    let f = pf.p.slice();
    if (tDrogue && t >= tDrogue && who === 'csm') f = add(f, mul(unit(f), t >= tMain ? 0.028 : 0.018));
    if (who === 'csm' && t < T.tde) { const g = pf.v && t > 13 && norm(accelOf(stackState, t)) > 2.5e-4 ? unit(accelOf(stackState, t)) : unit(pf.p); f = add(f, mul(g, t < T.sicCutoff ? 0.058 : t < T.siiCutoff ? 0.036 : 0.02)); }
    return f;
  }
  function drawPane(pane) {
    const t = simT, dt = lastDt, st = stackState(t), ls = lmState(t), mp = M.moonPos(t);
    const pv = pane.pv, pc = pane.pc, pl = pane.lbl;
    const pf = pane.who === 'lm' && ls ? { p: lmVisualPos(t, ls, st), v: ls.v } : { p: csmVis(t), v: st.v };
    const mscP = M.geoToECI(t, MSC.lat, MSC.lon, 0);
    F = focusFor(pv, pane.who, t, st, ls, mp);
    // fly between views: the focus slides across while the camera backs out far enough to take in both ends
    const tr = trans && pane.pc === cam && !splitActive ? trans : null;
    if (tr) {
      // The camera first turns toward the destination, then flies a straight line from its old eye point to the
      // new one, covering distance at a constant ratio (like a zoom) and swinging wide of Earth and the Moon.
      const FA = focusFor(tr.from, tr.who, t, st, ls, mp), FB = F;
      const offE = (o) => [o.x, -o.z, o.y];
      const offOf = (c) => { const ce = Math.cos(c.el); return c.E.clone().multiplyScalar(ce * Math.cos(c.az) * c.dist).addScaledVector(c.N, ce * Math.sin(c.az) * c.dist).addScaledVector(c.U, Math.sin(c.el) * c.dist); };
      const eyeA = add(FA, offE(offOf(tr.A))), eyeB = add(FB, offE(offOf(pc)));
      const D = Math.max(1e-6, norm(sub(eyeA, eyeB)));
      if (!tr.dur) { tr.dur = Math.min(4.5, 1.4 + 0.16 * Math.log(1 + D / Math.max(0.05, Math.min(tr.A.dist, pc.dist)))) * 1000; tr.t0 = performance.now(); }
      const u = Math.min(1, (performance.now() - tr.t0) / tr.dur); tr.s = u * u * u * (u * (u * 6 - 15) + 10);
      const eps = Math.min(D, Math.max(1e-4, pc.dist * 0.02)), sm = s3((u - 0.12) / 0.88), sm2 = sm * sm * (3 - 2 * sm);
      const r = D <= eps ? 1 - sm2 : (Math.exp(Math.log(D) * (1 - sm2) + Math.log(eps) * sm2) - eps) / (D - eps);
      let eye = add(eyeB, mul(sub(eyeA, eyeB), r));
      for (const [c, R] of [[[0, 0, 0], R_E], [mp, R_M]]) {
        // detour around a planet in the way, peaking where the straight line passes closest to it
        const ab = sub(eyeB, eyeA), k = Math.max(0, Math.min(1, dot(sub(c, eyeA), ab) / dot(ab, ab))), cp = add(eyeA, mul(ab, k)), dc = norm(sub(cp, c));
        if (k > 0.02 && k < 0.98 && dc < R * 1.25) { const p = 1 - r, wgt = Math.exp(-Math.pow((p - k) / (0.35 * Math.min(k, 1 - k) + 0.02), 2)); eye = add(eye, mul(dc > 1 ? unit(sub(cp, c)) : unit(cross(ab, [0, 0, 1])), (R * 1.25 - dc) * wgt)); }
        // and never inside it: the allowed radius relaxes only near the start and end points
        const rA = norm(sub(eyeA, c)), rB = norm(sub(eyeB, c)), de = norm(sub(eye, c));
        const allow = Math.min(R * 1.12, Math.max(rB, R + 0.5 * norm(sub(eye, eyeB))), Math.max(rA, R + 0.5 * norm(sub(eye, eyeA))));
        if (de < allow && de > 1e-6) eye = add(c, mul(unit(sub(eye, c)), allow));
      }
      F = add(FA, mul(sub(FB, FA), s3(u / 0.45)));
      tr.eyeRel = sub(eye, F); tr.u = u;
    }
    earth.position.copy(toV3([0, 0, 0])); earth.rotation.y = M.gmst(t); atmo.position.copy(earth.position);
    moon.position.copy(toV3(mp)); orientMoon(t);
    moonOrbit.position.copy(earth.position);
    linesE.forEach((l) => { l.position.copy(earth.position); l.material.uniforms.uT.value = t; });
    { const u = linesE[0].material.uniforms, d = W_E * (t - tIns); u.uRot.value = 1; u.uTi.value = tIns; u.uWrap.value = d - 2 * Math.PI * Math.round(d / (2 * Math.PI)); }
    linesM.forEach((l) => { l.position.copy(moon.position); l.material.uniforms.uT.value = t; });
    scene.userData.stars.position.copy(camera.position);
    const kscP = M.geoToECI(t, KSC.lat, KSC.lon, 0);
    padM.position.copy(toV3(kscP)); padM.quaternion.setFromUnitVectors(yAxis, dirV3(unit(kscP)).normalize()); padM.visible = true;

    const acc = t > 0 && t < tEI ? accelOf(stackState, t) : [0, 0, 0];
    const burning = norm(acc) * 1000 > 0.25;
    engName = 'Off';
    const showSaturn = t < T.tde;
    saturn.visible = showSaturn; csm.visible = !showSaturn;
    if (showSaturn) {
      const u = saturn.userData;
      u.sic.visible = t < T.sicCutoff; u.sii.visible = t < T.siiCutoff; u.les.visible = t < 197.9; u.csm.visible = true; u.sla.visible = true;
      const base = t < T.sicCutoff ? 0 : t < T.siiCutoff ? 42 : 72.4;
      saturn.position.copy(toV3(st.p)); orient(saturn, t <= 13 ? unit(st.p) : (burning ? acc : st.v), t <= 13 ? 'snap' : 0);
      saturn.position.add(new THREE.Vector3(0, -base * mm, 0).applyQuaternion(saturn.quaternion));
      u.pIc.visible = t > -3 && t < T.sicCutoff; u.pII.visible = t > T.siiIgn && t < T.siiCutoff; u.pIVB.visible = (t > T.siiCutoff + 3 && t < tIns + 1) || (t >= tTliIgn && t <= tTliEnd);
      [u.pIc, u.pII, u.pIVB].forEach((p) => { if (p.visible) p.scale.setScalar(0.92 + Math.random() * 0.12); });
      if (u.pIc.visible) engName = 'S-IC ×5 F-1'; else if (u.pII.visible) engName = 'S-II ×5 J-2'; else if (u.pIVB.visible) engName = 'S-IVB J-2';
    }
    const spent = (obj, tSep, base) => {
      if (t < tSep || t > tSep + 90) { obj.visible = false; return; }
      obj.visible = true; const s0 = stackState(tSep), dts = t - tSep, g = M.grav(tSep, s0.p);
      obj.position.copy(toV3(add(add(s0.p, mul(s0.v, dts)), mul(add(g, mul(unit(s0.v), -0.012)), 0.5 * dts * dts)))); orient(obj, s0.v, 'snap'); obj.rotateX(dts * 0.01);
      obj.position.add(new THREE.Vector3(0, -base * mm, 0).applyQuaternion(obj.quaternion));
    };
    spent(spentIC, T.sicCutoff, 0); spent(spentII, T.siiCutoff, 42);
    if (!showSaturn) {
      const u = csm.userData, inEntry = t >= T.cmSep;
      csm.position.copy(toV3(csmVis(t))); u.sm.visible = !inEntry; csm.quaternion.copy(csmQuat(t));
      if (burning && !inEntry) engName = t < T.lmExtract ? 'S-IVB J-2' : 'SPS';
      u.plume.visible = burning && !inEntry && t > T.lmExtract; if (u.plume.visible) u.plume.scale.setScalar(0.9 + Math.random() * 0.15);
      if (inEntry && t >= tEI - 30 && t < tEI + 420) { u.glow.material.opacity = Math.min(0.85, norm(accelOf(stackState, t)) / 0.06); u.glow.visible = true; } else u.glow.visible = false;
      u.drogues.visible = !!tDrogue && t >= tDrogue && t < tMain && t < tSplash; u.mains.visible = !!tMain && t >= tMain && t < tSplash + 60;
      if (inEntry && t > tEI - 60 && t < tDrogue) engName = 'Entry · ' + (norm(accelOf(stackState, t)) * 1000 / 9.80665).toFixed(1) + ' g';
    }
    const dockedLM = (t >= T.tde && t < T.undock) || (t >= T.docking && t < T.lmJett);
    lmDocked.visible = dockedLM && csm.visible;
    if (lmDocked.visible && t < T.lmExtract) {
      // during transposition Eagle is still in the adapter on top of the S-IVB
      const n = n0At(t); lmDocked.quaternion.copy(qOf(n)); lmDocked.position.copy(toV3(add(sivbBase(t), mul(n, 19.5 / 1000))));
      lmDocked.userData.desc.visible = true; lmDocked.userData.dpl.visible = false; lmDocked.userData.apl.visible = false;
    } else if (lmDocked.visible) {
      lmDocked.quaternion.copy(csm.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI));
      lmDocked.position.copy(csm.position).add(new THREE.Vector3(0, (11.1 + 6.1) * mm, 0).applyQuaternion(csm.quaternion));
      lmDocked.userData.desc.visible = t < T.undock; lmDocked.userData.dpl.visible = false; lmDocked.userData.apl.visible = false;
    }
    if (t >= T.tde && t < T.lmExtract && csm.visible) {
      sivbM.visible = true; sivbM.quaternion.copy(qOf(n0At(t))); sivbM.position.copy(toV3(sivbBase(t))); sivbM.userData.plume.visible = false;
    } else if (t >= T.lmExtract && t < SV.t1) { const sv = SV.at(t); sivbM.visible = true; sivbM.position.copy(toV3(add(sv.p, sivbC()))); sivbM.quaternion.copy(qOf(sv.v)); sivbM.userData.plume.visible = false; }
    else sivbM.visible = false;
    // adapter panels hinge open and drift away when Columbia separates
    { const tau = t - T.tde; slaPanels.visible = sivbM.visible && tau >= 0 && tau < 900;
      if (slaPanels.visible) slaPanels.children.forEach((pv) => { const d = pv.userData, a = 0.8 * s3(tau / 5) + Math.max(0, tau - 6) * 0.004;
        pv.quaternion.setFromAxisAngle(d.axis, a); pv.position.copy(d.hinge).addScaledVector(d.out, Math.max(0, tau - 6) * 0.35 * mm); }); }
    smSpent.visible = t >= T.cmSep && t < tEI + 120;
    if (smSpent.visible) {
      const q0 = csmQuat(T.cmSep - 0.01), dts = t - T.cmSep, side = toECI(new THREE.Vector3(1, 0, 0).applyQuaternion(q0));
      smSpent.position.copy(toV3(add(stackState(t).p, mul(add(mul(noseOf(q0), -1), mul(side, 0.35)), (0.3 * s3(dts / 3) + 0.6 * dts) / 1000))));
      smSpent.quaternion.copy(q0).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dts * 0.004));
    }

    lm.visible = !!ls && !dockedLM;
    lmEng = '';
    if (lm.visible) {
      const u = lm.userData, onSurface = t >= tTouch && t < tLift;
      lm.position.copy(toV3(ls.p)); u.desc.visible = t < tLift;
      const la = onSurface ? [0, 0, 0] : accelOf(lmState, t), lt = norm(la) * 1000;
      if (t >= T.lmJett) lm.quaternion.copy(csmQuat(T.lmJett)).multiply(flipX).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (t - T.lmJett) * 0.002));
      else if (!onSurface) lm.quaternion.copy(lmQuat(t));
      // Undocking / docking: blend from the docked pose (inverted on Columbia's nose), with the slow
      // 360-degree pirouette Eagle flew so Collins could inspect it.
      {
        const { w: wDock, spin } = dockBlend(t);
        lm.position.copy(toV3(lmVisualPos(t, ls, st)));
        if ((wDock > 0 || spin > 0) && csm.visible) {
          const qd = csmQuat(t).clone().multiply(flipX);
          const qf = lmQuat(t).clone().multiply(new THREE.Quaternion().setFromAxisAngle(yAxis, spin));
          lm.quaternion.copy(qd).slerp(qf, 1 - wDock);
        }
      }
      u.dpl.visible = !onSurface && t < tTouch && lt > 0.15; u.apl.visible = t >= tLift && lt > 0.15 && t < T.tpi;
      if (u.dpl.visible) { u.dpl.scale.setScalar(Math.max(0.3, Math.min(1.1, lt / 3)) * (0.9 + Math.random() * 0.15)); lmEng = 'DPS ' + fmtNum(Math.min(100, lt * (ls.m || 1e4) / 450.4)) + '%'; }
      if (u.apl.visible) { u.apl.scale.setScalar(0.9 + Math.random() * 0.15); lmEng = 'APS'; }
    }
    lmDescentLeft.visible = t >= tLift;
    if (lmDescentLeft.visible) { const sp = siteAt(t); lmDescentLeft.position.copy(toV3(sp)); orient(lmDescentLeft, unit(sub(sp, mp)), 'snap'); }
    // site-local frame: X = east, Y = up, Z = south; Eagle's hatch faces west as it did
    {
      const onMoon = t >= tTouch - 5;
      evaGroup.visible = onMoon;
      if (onMoon) {
        const b = siteBasis(t);
        evaGroup.position.copy(toV3(b.o));
        basisTmp.makeBasis(dirV3(b.east), dirV3(b.up), dirV3(mul(b.north, -1))); evaGroup.quaternion.setFromRotationMatrix(basisTmp);
        const lmB = new THREE.Matrix4().makeBasis(dirV3(mul(b.east, -1)), dirV3(b.up), dirV3(b.north)), lq = new THREE.Quaternion().setFromRotationMatrix(lmB);
        if (lm.visible && t >= tTouch && t < tLift) lm.quaternion.copy(t < tTouch + 6 ? lmQuat(tTouch - 0.5).clone().slerp(lq, s3((t - tTouch) / 6)) : lq);
        else if (lm.visible && t >= tLift && t < tLift + 15) lm.quaternion.copy(lq.clone().slerp(lmQuat(t), s3((t - tLift) / 15)));
        if (lmDescentLeft.visible) lmDescentLeft.quaternion.copy(lq);
        evaPos.A = placeAstro(armstrong, EVA.armstrong, t, 0); evaPos.B = placeAstro(aldrin, EVA.aldrin, t, 0.4);
        feet.count = footIdx(t);
        for (const [k, obj] of Object.entries(gear)) { const g = EVA.gear[k]; obj.visible = t >= g.from && (!g.to || t < g.to); }
        // the ascent-engine blast knocks the flag over at liftoff
        const fall = Math.max(0, Math.min(1, (t - tLift - 0.5) / 2.5)); gear.flag.rotation.z = fall * fall * 1.45;
      }
    }
    // Houston: the Manned Spacecraft Center and downtown, drawn only when the camera is close enough to see them
    {
      const near = norm(sub(add(F, [camera.position.x, -camera.position.z, camera.position.y]), mscP)) < 600 || pv === 'houston';
      mscG.visible = dtnG.visible = near;
      const nearK = norm(sub(add(F, [camera.position.x, -camera.position.z, camera.position.y]), M.geoToECI(t, KSC.lat, KSC.lon, 0))) < 600 || pv === 'ksc';
      kscG.visible = nearK; if (nearK) placeLocal(kscG, t, KSC);
      if (near) {
        const b = placeLocal(mscG, t, MSC); placeLocal(dtnG, t, DTN);
        const sEl = dot(b.up, sunDir); matOffice.emissiveIntensity = matTower.emissiveIntensity = Math.max(0, Math.min(1, (0.06 - sEl) / 0.12));
      }
    }
    {
      let U;
      if (pv === 'houston') U = dirV3(unit(mscP)).normalize();
      else if (pv === 'ksc') U = dirV3(unit(M.geoToECI(t, KSC.lat, KSC.lon, 0))).normalize();
      else if (pv === 'craft') { const c = central(pf.p, t) === 'moon' ? mp : [0, 0, 0]; U = dirV3(unit(sub(pf.p, c))).normalize(); } else U = new THREE.Vector3(0, 1, 0);
      if (pv === 'craft' || pv === 'houston' || pv === 'ksc') {
        const E = new THREE.Vector3(0, 1, 0).cross(U); if (E.lengthSq() < 1e-6) E.set(1, 0, 0); E.normalize();
        const kk = pc.snap ? 1 : 1 - Math.exp(-dt * 6); pc.snap = false; pc.U.lerp(U, kk).normalize(); pc.E.lerp(E, kk).normalize(); pc.N.copy(pc.U).cross(pc.E).normalize();
      } else { pc.U.set(0, 1, 0); pc.E.set(1, 0, 0); pc.N.set(0, 0, -1); }
      pc.dist += (pc.distGoal - pc.dist) * (1 - Math.exp(-dt * 9));
      if (pc.elGoal != null) { pc.el += (pc.elGoal - pc.el) * (1 - Math.exp(-dt * 1.2)); if (Math.abs(pc.elGoal - pc.el) < 0.002) pc.elGoal = null; }
      // keep the camera above the ground: height of the eye = focus altitude + dist*sin(el) >= 1.5 m
      if (pv === 'craft' || pv === 'houston' || pv === 'ksc') {
        const fp = pv === 'houston' || pv === 'ksc' ? focusFor(pv, pane.who, t, st, ls, mp) : pf.p, onMoon = central(fp, t) === 'moon', c = onMoon ? mp : [0, 0, 0];
        const a0 = norm(sub(fp, c)) - (onMoon ? R_M : R_E), hMin = 0.0015;
        if (a0 < 50) { const elMin = Math.asin(Math.max(-1, Math.min(0.95, (hMin - a0) / Math.max(pc.dist, 1e-4)))); if (pc.el < elMin) pc.el = elMin; }
      }
      const ce = Math.cos(pc.el);
      camera.position.copy(pc.E).multiplyScalar(ce * Math.cos(pc.az) * pc.dist).addScaledVector(pc.N, ce * Math.sin(pc.az) * pc.dist).addScaledVector(pc.U, Math.sin(pc.el) * pc.dist);
      camera.up.copy(pc.U);
      if (tr && tr.eyeRel) {
        const A = tr.A; camera.position.set(tr.eyeRel[0], tr.eyeRel[2], -tr.eyeRel[1]);
        const qu = new THREE.Quaternion().setFromUnitVectors(A.U.clone().normalize(), pc.U.clone().normalize());
        camera.up.copy(A.U).normalize().applyQuaternion(new THREE.Quaternion().slerp(qu, tr.s));
        if (tr.u >= 1) trans = null;
      }
      camera.lookAt(0, 0, 0);
      const camE = [camera.position.x + F[0], -camera.position.z + F[1], camera.position.y + F[2]];
      const hE = norm(camE) - R_E, sunEl = dot(unit(camE), sunDir);
      const k = Math.max(0, Math.min(1, 1 - hE / 70)) * Math.max(0, Math.min(1, (sunEl + 0.08) / 0.3));
      const tw = Math.max(0, Math.min(1, 1 - hE / 70)) * Math.max(0, Math.min(1, (sunEl + 0.22) / 0.2)) * (1 - k);  // pre-dawn twilight (Apollo 11 splashed down before sunrise)
      skyCol.setRGB(0.02 + 0.30 * k + 0.03 * tw, 0.03 + 0.52 * k + 0.06 * tw, 0.045 + 0.85 * k + 0.16 * tw); scene.background = skyCol;
      scene.userData.stars.visible = k < 0.25; atmo.visible = hE > 120;
    }
    camera.aspect = pane.w / Math.max(1, pane.h); camera.updateProjectionMatrix();
    earth.updateMatrixWorld(); moon.updateMatrixWorld();
    earthMat.uniforms.uBodyInv.value.setFromMatrix4(earth.matrixWorld).transpose();
    moonMat.uniforms.uBodyInv.value.setFromMatrix4(moon.matrixWorld).transpose();
    {
      // ground detail is drawn around whichever site the camera is nearest: Houston, the Cape, or the recovery area
      const camW = add(F, [camera.position.x, -camera.position.z, camera.position.y]);
      const hou = norm(sub(camW, mscP)) < 900;
      const kscW = M.geoToECI(t, KSC.lat, KSC.lon, 0), ksc = !hou && (t < 50000 || norm(sub(camW, kscW)) < 900);
      toV3(hou ? mscP : ksc ? kscW : M.geoToECI(t, splashLL.lat, splashLL.lon, 0), earthMat.uniforms.uOriginW.value);
      earthMat.uniforms.uKscOn.value = hou ? 2 : ksc ? 1 : 0;
      { const la = (hou ? MSC : KSC).lat * D2R, lo = (hou ? MSC : KSC).lon * D2R; earthMat.uniforms.uEastE.value.set(-Math.sin(lo), 0, -Math.cos(lo)); earthMat.uniforms.uNorthE.value.set(-Math.sin(la) * Math.cos(lo), Math.cos(la), Math.sin(la) * Math.sin(lo)); }
    }
    toV3(siteAt(t), moonMat.uniforms.uOriginW.value);
    { const camE2 = [camera.position.x + F[0], -camera.position.z + F[1], camera.position.y + F[2]], hc = norm(camE2) - R_E; earthMat.uniforms.uHaze.value = Math.max(0, Math.min(1, 1 - hc / 60)); earthMat.uniforms.uNear.value = hc < 400 ? 1 : 0; moonMat.uniforms.uNear.value = norm(sub(camE2, mp)) - R_M < 400 ? 1 : 0; }
    const w = pane.w, h = pane.h, ox = pane.x, oy = pane.y, camDist = camera.position.length();
    placeLabel(pl.csm, st.p, camDist > 2, w, h, ox, oy);
    placeLabel(pl.lm, ls ? lmVisualPos(t, ls, st) : st.p, !!ls && !dockedLM && camDist > 2 && t >= T.undock + 120, w, h, ox, oy);
    placeLabel(pl.earth, [0, 0, R_E * 1.05], camDist > 30000 || pv === 'overview', w, h, ox, oy);
    placeLabel(pl.moon, add(mp, mul(M.moonAxes(t).z, R_M * 1.1)), camDist > 9000 || pv === 'overview', w, h, ox, oy);
    placeLabel(pl.site, siteAt(t), t >= tTouch && camDist > 1 && camDist < 30000, w, h, ox, oy);
    placeLabel(pl.ksc, M.geoToECI(t, KSC.lat, KSC.lon, 0), t < 1200 && norm(sub(add(F, [camera.position.x, -camera.position.z, camera.position.y]), M.geoToECI(t, KSC.lat, KSC.lon, 0))) > 60 && camDist < 40000, w, h, ox, oy);
    placeLabel(pl.splash, M.geoToECI(t, splashLL.lat, splashLL.lon, 0), t > T.cmSep && camDist > 3 && camDist < 40000, w, h, ox, oy);
    { const b = t >= tTouch ? siteBasis(t) : null; const at = (p) => add(add(add(b.o, mul(b.east, p.e / 1000)), mul(b.north, p.n / 1000)), mul(b.up, (p.h + 2.3) / 1000));
      placeLabel(pl.arm, evaPos.A && b ? at(evaPos.A) : [0, 0, 0], !!(evaPos.A && b) && camDist < 0.4, w, h, ox, oy);
      placeLabel(pl.ald, evaPos.B && b ? at(evaPos.B) : [0, 0, 0], !!(evaPos.B && b) && camDist < 0.4, w, h, ox, oy);
      const sb = siteBasis(t), spot = (e, n) => add(add(add(sb.o, mul(sb.east, e / 1000)), mul(sb.north, n / 1000)), mul(sb.up, 0.004));
      placeLabel(pl.lwc, spot(70, -6), t > EVA.hatchOpen && t < tLift + 600 && camDist < 0.4, w, h, ox, oy);
      placeLabel(pl.wc, spot(-400, 10), t > tPdi + 480 && t < tLift + 600 && camDist < 3, w, h, ox, oy); }
    {
      const camW = add(F, [camera.position.x, -camera.position.z, camera.position.y]), hc = norm(camW) - R_E;
      GEO.forEach(([, la, lo, hmax], i) => placeLabel(pl.geo[i], M.geoToECI(t, la, lo, 0), hc > 60 && hc < hmax, w, h, ox, oy));
      SEAS.forEach(([, la, lo], i) => placeLabel(pl.seas[i], M.geoToECI(t, la, lo, 0), hc > 250 && hc < 60000, w, h, ox, oy));
      KSCL.forEach(([, , la, lo, ht, , dmin, dmax], i) => { const p = M.geoToECI(t, la, lo, ht / 1000), d = norm(sub(camW, p)); placeLabel(pl.kscl[i], p, d > dmin && d < dmax && hc < 120, w, h, ox, oy); });
      HOU.forEach(([, , la, lo, ht, , dmin, dmax], i) => { const p = M.geoToECI(t, la, lo, ht / 1000), d = norm(sub(camW, p)); placeLabel(pl.hou[i], p, d > dmin && d < dmax && hc < 120, w, h, ox, oy); });
    }
    placeLabel(pl.sivb, t > T.lmExtract + 300 && t < SV.t1 ? SV.at(t).p : [0, 0, 0], t > T.lmExtract + 300 && t < SV.t1 && camDist > 2, w, h, ox, oy);
    const VH = canvas.getBoundingClientRect().height;
    renderer.setViewport(ox, VH - oy - h, w, h); renderer.setScissor(ox, VH - oy - h, w, h);
    renderer.render(scene, camera);
  }
  const panesEl = $('panes');
  const tagA = document.createElement('div'), tagB = document.createElement('div'), divEl = document.createElement('div');
  tagA.className = 'pane-tag csm'; tagA.textContent = 'Columbia'; tagB.className = 'pane-tag lm'; tagB.textContent = 'Eagle'; divEl.className = 'pane-div';
  panesEl.append(tagA, tagB, divEl);
  function renderPaneChrome(panes) {
    const on = panes.length === 2; tagA.hidden = tagB.hidden = divEl.hidden = !on;
    if (!on) return;
    const [A, B] = panes, top = 88;
    tagA.style.left = (A.x + 12) + 'px'; tagA.style.top = (A.y + (A.y === 0 ? top : 10)) + 'px';
    tagB.style.left = (B.x + 12) + 'px'; tagB.style.top = (B.y + (B.y === 0 ? top : 10)) + 'px';
    if (splitSide) { Object.assign(divEl.style, { left: B.x + 'px', top: '0px', width: '1px', height: '100%' }); }
    else { Object.assign(divEl.style, { left: '0px', top: B.y + 'px', width: '100%', height: '1px' }); }
  }

  let lastDt = 0;
  function frame(now) {
    const rawDt = (now - lastFrame) / 1000, dt = Math.min(0.25, rawDt); lastFrame = now; lastDt = dt;
    advance(dt);
    const t = simT;
    if (typing && now >= (typing.at || 0)) stepTyping(now);
    for (const a of Object.values(agcs)) { syncClock(a, false); a.run(Math.min(0.5, rawDt)); }

    sunDir = M.sunDir(t); sunV.copy(dirV3(sunDir)).normalize(); sun.position.copy(sunV);
    const st = stackState(t), ls = lmState(t), who = followed(), mp = M.moonPos(t);
    const both = !!ls && t >= T.undock + 30 && t < T.docking;
    splitChip.disabled = !both;
    if (prevFollow && prevFollow !== who && view === 'craft') setView('craft');
    { const k = craftEl(t); if (elKey !== null && k !== elKey && view === 'craft') cam.elGoal = k; elKey = k; }
    prevFollow = who;
    followEl.textContent = who === 'lm' ? 'Follow Columbia' : 'Follow Eagle';
    // only offered while Eagle and Columbia fly separately (and not in split view, which shows both)
    followEl.hidden = !(t >= T.undock && t < T.docking) || view === 'split';
    const vr = canvas.getBoundingClientRect(), VW = vr.width, VH = vr.height;
    splitActive = view === 'split' && both; splitSide = VW >= VH;
    const panes = splitActive
      ? [{ who: 'csm', pv: 'craft', pc: cam, lbl: LBL, x: 0, y: 0, w: splitSide ? VW / 2 : VW, h: splitSide ? VH : VH / 2 },
         { who: 'lm', pv: 'craft', pc: camB, lbl: LBL2, x: splitSide ? VW / 2 : 0, y: splitSide ? 0 : VH / 2, w: splitSide ? VW / 2 : VW, h: splitSide ? VH : VH / 2 }]
      : [{ who, pv: view === 'split' ? 'craft' : view, pc: cam, lbl: LBL, x: 0, y: 0, w: VW, h: VH }];
    if (!splitActive) Object.values(LBL2).flat().forEach((el) => (el.hidden = true));
    renderer.setScissorTest(true);
    for (const pane of panes) drawPane(pane);
    rendered = true; lastWho = panes[0].who;
    renderPaneChrome(panes);


    if (now - lastUI > 90) {
      lastUI = now;
      els.get.textContent = fmtGET(t);
      els.utc.textContent = new Date(LAUNCH_UTC + t * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
      const tv = who === 'lm' && ls ? ls : st, ctr = central(tv.p, t), cp = ctr === 'moon' ? mp : [0, 0, 0];
      const alt = norm(sub(tv.p, cp)) - (ctr === 'moon' ? R_M : R_E), vrel = ctr === 'moon' ? sub(tv.v, M.moonVel(t)) : tv.v;
      els.altK.textContent = (ctr === 'moon' ? 'Lunar' : 'Earth') + ' altitude'; els.velK.textContent = 'Velocity (' + (ctr === 'moon' ? 'Moon' : 'Earth') + ')';
      els.alt.innerHTML = alt < 100 ? fmtNum(Math.max(0, alt * 1000)) + '<small>m</small>' : fmtNum(alt) + '<small>km</small>';
      els.vel.innerHTML = fmtNum(norm(vrel) * 1000) + '<small>m/s</small>';
      els.de.innerHTML = fmtNum(norm(tv.p)) + '<small>km</small>';
      els.dm.innerHTML = fmtNum(Math.max(0, norm(sub(tv.p, mp)) - R_M)) + '<small>km</small>';
      els.mass.innerHTML = fmtNum((tv.m || 0) / 1000, 1) + '<small>t</small>';
      { const o = orbitText(who, t); $('tOrb').textContent = o.text; $('tOrbBar').style.width = (o.frac * 100).toFixed(1) + '%'; }
      const eng = who === 'lm' ? (lmEng || 'Off') : engName; els.eng.textContent = eng; els.eng.classList.toggle('burn', eng !== 'Off');
      if (t < 0) { $('evPhase').textContent = 'Countdown · 16 July 1969'; $('evTitle').textContent = 'T−' + Math.ceil(-t) + ' s'; $('evDesc').textContent = 'Saturn V on Pad 39A with Armstrong, Collins and Aldrin aboard. Ignition sequence starts at T−8.9 s.'; $('evFacts').innerHTML = ''; $('evTry').hidden = true; cardToggle.hidden = true; shownEvent = null; if (cmdFor) renderCmd(null); }
      else if (!shownEvent || (currentEvent(t) && currentEvent(t).t > shownEvent.t)) showEvent(currentEvent(t), false);
      const pct = xOf(t); els.fill.style.width = pct + '%'; els.head.style.left = pct + '%';
      logItems.forEach(({ e, b }) => b.classList.toggle('past', e.t <= t));
      $('agcState').textContent = 'CMC ' + fmtGET(agcs.cm.seconds).slice(1) + ' · LGC ' + fmtGET(agcs.lm.seconds).slice(1) + ' run time';
    }
    renderDSKY();
    requestAnimationFrame(frame);
  }
  window.__sim = { advance: (d) => advance(d), scene, camera, cam, earth, moon, setView, jumpTo: (t) => jumpTo(t), setWarp: userWarp, agcs, notes: NOTES, ev: EV, get t() { return simT; }, get trans() { return trans; }, set playing(v) { playing = v; } };
  setView('craft');
  $('loading').hidden = true;
  requestAnimationFrame(frame);
})().catch((e) => { const l = document.getElementById('loading'); if (l) { l.hidden = false; l.textContent = 'Could not start: ' + e.message; } console.error(e); });
