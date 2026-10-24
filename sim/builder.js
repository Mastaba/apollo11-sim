// SPDX-License-Identifier: GPL-2.0-or-later
// Part of the Apollo 11 simulator. Free software under the GNU GPL v2 or later; see the Licences section of the page.
// Builds the full Apollo 11 trajectory set in 3D from solved targeting parameters.
// P = { tli: [dv km/s, pitch deg, yaw deg], tei: [dv, pitch, yaw], downrange deg, brakeThr }
(function (root) {
  const C = root.MissionCore || require('./mission.js');
  const { MU_E, MU_M, R_E, R_M, W_E, T, SITES, ENG, add, sub, mul, dot, cross, norm, unit, sind, cosd, makeModel, osc, fly, Track, jerkTarget, jerk1 } = C;
  const G = 9.80665, D2R = Math.PI / 180;
  let MODEL = null; const model = () => MODEL || (MODEL = makeModel());

  const moonRel = (M, t, s) => ({ r: sub(s.slice(0, 3), M.moonPos(t)), v: sub(s.slice(3, 6), M.moonVel(t)) });
  // signed angle of r ahead of ref, measured about axis hU, with ref projected into the plane
  const angAlong = (r, ref, hU) => { const rp = sub(ref, mul(hU, dot(ref, hU))); return Math.atan2(dot(cross(rp, r), hU), dot(rp, r)); };
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  // burn direction: prograde rotated by pitch (toward radial-out) and yaw (toward orbit normal)
  const steer = (vRel, rRel, pitch, yaw) => {
    const vU = unit(vRel), hU = unit(cross(rRel, vRel)), rU = unit(cross(vU, hU));
    return add(mul(add(mul(vU, cosd(pitch)), mul(rU, -sind(pitch))), cosd(yaw)), mul(hU, sind(yaw)));
  };

  // ---------- Saturn V ascent ----------
  function launch(M, track, incDeg) {
    const r0 = M.geoToECI(0, SITES.ksc.lat, SITES.ksc.lon, 0), v0 = cross([0, 0, W_E], r0);
    // target plane: contains the pad at liftoff, inclination 32.52 deg (Apollo 11 parking orbit), heading north-east
    const inc = (incDeg || 32.521) * D2R, up0 = unit(r0);
    // n = alpha*east + beta*north, with n_z = cos(inc)  ->  beta = cos(inc)/cos(lat)
    const east = unit(cross([0, 0, 1], up0)), north = cross(up0, east);
    const beta = Math.cos(inc) / Math.sqrt(1 - up0[2] * up0[2]), alpha = Math.sqrt(Math.max(0, 1 - beta * beta));
    let n = add(mul(east, alpha), mul(north, beta));
    if (dot(cross(n, up0), north) < 0) n = add(mul(east, -alpha), mul(north, beta)); // ascending (north-east) branch
    let s = [...r0, ...v0, 2.938e6], t = 0;
    track.push(t, s);
    const hT = 191.2;
    const stages = [
      { eng: ENG.SIC, start: 0, end: T.sicCutoff, after: 6.66e5 },
      { eng: ENG.SII, start: T.siiIgn, end: T.siiCutoff, after: 1.68e5 },
      { eng: ENG.SIVB, start: T.siiCutoff + 3.7, end: null },
    ];
    for (const [k, st] of stages.entries()) {
      if (t < st.start) ({ t, s } = fly(M, track, t, s, st.start, { dt: 0.5 }));
      const ctrl = (tt, ss) => {
        const r = ss.slice(0, 3), v = ss.slice(3, 6), rn = norm(r), alt = rn - R_E, up = unit(r);
        const hz = unit(cross(n, up));
        const a = st.eng.F / ss[6] / 1000, vr = dot(v, up), vh = dot(v, hz), xn = dot(r, n), vn = dot(v, n);
        let sinP, aL = 0;
        if (tt < 13) sinP = 1;
        else if (k === 0) {
          const x = Math.min(1, (tt - 13) / (T.sicCutoff - 13));
          sinP = Math.cos((Math.PI / 2) * (0.62 * x) * (1 + 0.35 * (1 - x)));
          aL = Math.max(-0.12 * a, Math.min(0.12 * a, jerk1(xn, vn, 0, 0, 500 - tt)));
        } else {
          const vc = Math.sqrt(MU_E / (R_E + hT));
          const tgo = Math.max(30, (vc - vh) / Math.max(a, 1e-6) * 0.92);
          const g = MU_E / rn ** 2 - vh * vh / rn;
          const aV = jerk1(alt, vr, hT, 0, tgo) + g;
          aL = jerk1(xn, vn, 0, 0, Math.max(20, tgo));
          sinP = Math.max(-0.6, Math.min(0.9, aV / a));
          aL = Math.max(-0.3 * a, Math.min(0.3 * a, aL));
        }
        const sinL = aL / a, ch = Math.sqrt(Math.max(0, 1 - sinP * sinP - sinL * sinL));
        const dir = add(add(mul(up, sinP), mul(hz, ch)), mul(n, sinL));
        let acc = mul(dir, a);
        if (alt < 110) {
          const vrel = sub(v, cross([0, 0, W_E], r)), vrn = norm(vrel);
          if (vrn > 1e-6) { const rho = 1.225 * Math.exp(-alt / 7.2); acc = sub(acc, mul(unit(vrel), 0.5 * rho * (vrn * 1000) ** 2 * 0.35 * 113 / ss[6] / 1000)); }
        }
        return { acc, mdot: st.eng.F / (st.eng.isp * G) };
      };
      const stop = st.end ? null : (tt, ss) => norm(ss.slice(3, 6)) >= Math.sqrt(MU_E / norm(ss.slice(0, 3)));
      ({ t, s } = fly(M, track, t, s, st.end || 3000, { dt: 0.25, ctrl, stop }));
      if (st.after) s[6] = st.after;
    }
    return { t, s, n };
  }

  function findPeri(M, t, s, body, tMax) {
    let best = null, lastD = Infinity, lastT = t, lastS = s;
    const center = body === 'moon' ? M.moonPos : () => [0, 0, 0];
    fly(M, null, t, s, tMax, {
      post: (tt, ss) => { const d = norm(sub(ss.slice(0, 3), center(tt))); if (d > lastD && !best && lastD < (body === 'moon' ? 40000 : 200000)) best = { t: lastT, s: lastS, d: lastD }; lastD = d; lastT = tt; lastS = ss; },
      stop: () => !!best,
    });
    if (!best) return null;
    let tt = best.t - 300, ss; ({ t: tt, s: ss } = fly(M, null, t, s, Math.max(t, tt)));
    let bt = tt, bs = ss, bd = Infinity;
    fly(M, null, tt, ss, tt + 600, { dt: 1, post: (t2, s2) => { const d = norm(sub(s2.slice(0, 3), center(t2))); if (d < bd) { bd = d; bt = t2; bs = s2; } } });
    return { t: bt, s: bs, d: bd };
  }
  function burn(M, track, t, s, eng, dirFn, stop, opts = {}) {
    let dv = 0; const thr = opts.throttle || 1, dt0 = opts.dt || 0.5;
    const ctrl = (tt, ss) => ({ acc: mul(dirFn(tt, ss), eng.F * thr / ss[6] / 1000), mdot: eng.F * thr / (eng.isp * G) });
    const tMax = t + (opts.maxT || 3000);
    while (t < tMax) {
      let dt = dt0; const aNow = eng.F * thr / s[6] / 1000;
      if (opts.dvTarget != null && dv + aNow * dt >= opts.dvTarget) dt = (opts.dvTarget - dv) / aNow;
      let ns = C.rk4(M, t, s, dt, ctrl), ddv = eng.isp * G / 1000 * Math.log(s[6] / ns[6]);
      if (opts.dvTarget == null && stop(t + dt, ns, dv + ddv)) {
        let lo = 0, hi = dt;
        for (let k = 0; k < 14; k++) { const mid = (lo + hi) / 2, ms = C.rk4(M, t, s, mid, ctrl), md = eng.isp * G / 1000 * Math.log(s[6] / ms[6]); if (stop(t + mid, ms, dv + md)) hi = mid; else lo = mid; }
        dt = hi; ns = C.rk4(M, t, s, dt, ctrl); ddv = eng.isp * G / 1000 * Math.log(s[6] / ns[6]);
        t += dt; s = ns; dv += ddv; if (track) track.push(t, s); break;
      }
      t += dt; s = ns; dv += ddv; if (track) track.push(t, s);
      if (opts.dvTarget != null && dv >= opts.dvTarget - 1e-12) break;
    }
    return { t, s, dv };
  }

  // ======================================================================
  function build(P, opts = {}) {
    const M = model();
    const ev = [], notes = {};
    const evt = (t, name, desc, phase) => ev.push({ t, name, desc, phase });
    const stack = new Track('CSM'), lmT = new Track('LM'), sivb = new Track('S-IVB');
    const site = SITES.tranq;
    const siteAt = (tt, alt) => M.selenoToECI(tt, site.lat, site.lon, alt || 0);

    let { t, s, n } = launch(M, stack, P.inc);
    notes.insertion = { t, alt: norm(s.slice(0, 3)) - R_E, v: norm(s.slice(3, 6)), oscE: osc(s.slice(0, 3), s.slice(3, 6), MU_E), inc: Math.acos(unit(cross(s.slice(0, 3), s.slice(3, 6)))[2]) / D2R };
    evt(0, 'Liftoff', 'Saturn V lifts off from Launch Complex 39A, Kennedy Space Center.', 'launch');
    evt(T.sicCutoff, 'S-IC staging', 'First stage cutoff and separation.', 'launch');
    evt(T.siiIgn, 'S-II ignition', 'Second stage ignition.', 'launch');
    evt(T.siiCutoff, 'S-II staging', 'Second stage cutoff; the S-IVB ignites for orbit insertion.', 'launch');
    evt(t, 'Earth orbit insertion', 'S-IVB cutoff. Parking orbit about 190 km high.', 'earth-orbit');
    s[6] = 1.395e5;
    if (opts.launchOnly) return { M, notes, stack };

    // ---- TLI
    ({ t, s } = fly(M, stack, t, s, T.tliIgn));
    const tliStart = t;
    let r = burn(M, stack, t, s, ENG.SIVB, (tt, ss) => steer(ss.slice(3, 6), ss.slice(0, 3), P.tli[1], P.tli[2]), null, { dt: 0.5, dvTarget: P.tli[0] });
    ({ t, s } = r);
    notes.tli = { start: tliStart, end: t, dv: r.dv, v: norm(s.slice(3, 6)) };
    evt(tliStart, 'TLI ignition', 'The S-IVB restarts for Trans-Lunar Injection.', 'tli');
    evt(t, 'TLI cutoff', 'Free-return trajectory to the Moon established.', 'translunar');
    evt(T.tde, 'Transposition & docking', 'Columbia separates, turns around and docks with Eagle.', 'translunar');
    evt(T.lmExtract, 'Eagle extracted', 'The docked CSM/LM pulls away from the S-IVB.', 'translunar');
    s[6] = 4.385e4;
    { const q = fly(M, null, t, s, T.lmExtract); sivb.push(T.lmExtract, q.s); const vs = add(q.s.slice(3, 6), mul(unit(q.s.slice(3, 6)), -0.0004)); fly(M, sivb, T.lmExtract, [...q.s.slice(0, 3), ...vs, 1e4], T.lmExtract + 8 * 3600); }

    const peri = findPeri(M, t, s, 'moon', T.loi1 + 60000);
    if (!peri) return { M, fail: 'no periselene', notes, stack };
    {
      const rel = moonRel(M, peri.t, peri.s), hU = unit(cross(rel.r, rel.v));
      const sp = unit(sub(siteAt(T.landing), M.moonPos(T.landing)));
      notes.peri = { t: peri.t, alt: peri.d - R_M, plane: dot(hU, sp), retro: dot(hU, M.moonAxes(peri.t).z), incl: Math.acos(dot(hU, M.moonAxes(peri.t).z)) / D2R };
      // B-plane: incoming asymptote S, B = b (S x h); desired: retrograde orbit whose plane holds the site at landing, rp = R_M + 111
      const h = cross(rel.r, rel.v), hn = norm(h), vv = norm(rel.v), rn = norm(rel.r);
      const eV = sub(mul(cross(rel.v, h), 1 / MU_M), mul(rel.r, 1 / rn)), e = norm(eV), p = unit(eV), q = cross(hU, p);
      const nu = Math.acos(-1 / e), S = mul(sub(mul(p, Math.cos(nu)), mul(q, Math.sin(nu))), -1);
      const vinf = Math.sqrt(vv * vv - 2 * MU_M / rn), b = hn / vinf, Bv = mul(unit(cross(S, hU)), b);
      const pole = M.moonAxes(peri.t).z;
      let hd = unit(cross(S, sp)); if (dot(hd, pole) > 0) hd = mul(hd, -1);
      const rpD = R_M + 111, bD = rpD * Math.sqrt(1 + 2 * MU_M / (rpD * vinf * vinf)), Bd = mul(unit(cross(S, hd)), bD);
      const Tb = unit(cross(S, pole)), Rb = cross(S, Tb);
      notes.bplane = { BT: dot(sub(Bv, Bd), Tb), BR: dot(sub(Bv, Bd), Rb) };
    }
    if (opts.translunarOnly) return { M, notes, stack };

    // ---- LOI-1 centred on periselene
    const loiDur = 357;
    ({ t, s } = fly(M, stack, t, s, peri.t - loiDur / 2));
    evt(t, 'LOI-1', 'Lunar Orbit Insertion burn behind the Moon.', 'loi');
    r = burn(M, stack, t, s, ENG.SPS, (tt, ss) => mul(unit(moonRel(M, tt, ss).v), -1), (tt, ss) => { const m = moonRel(M, tt, ss); return osc(m.r, m.v, MU_M).ra <= R_M + 313.0; });
    ({ t, s } = r); notes.loi1 = { dv: r.dv, dur: t - (peri.t - loiDur / 2) };
    { const m = moonRel(M, t, s), o = osc(m.r, m.v, MU_M); notes.loi1.orbit = { rp: o.rp - R_M, ra: o.ra - R_M }; }
    let p2 = findPeri(M, t, s, 'moon', t + 9000);
    while (p2 && p2.t < T.loi2 - 3600) { const q = fly(M, null, p2.t, p2.s, p2.t + 600); p2 = findPeri(M, q.t, q.s, 'moon', q.t + 9000); }
    ({ t, s } = fly(M, stack, t, s, p2.t - 8.5));
    evt(t, 'LOI-2', 'Circularisation burn.', 'lunar-orbit');
    r = burn(M, stack, t, s, ENG.SPS, (tt, ss) => mul(unit(moonRel(M, tt, ss).v), -1), (tt, ss) => { const m = moonRel(M, tt, ss); return osc(m.r, m.v, MU_M).ra <= R_M + 122.0; }, { dt: 0.1 });
    ({ t, s } = r); notes.loi2 = { dv: r.dv, dur: t - (p2.t - 8.5) };
    { const m = moonRel(M, t, s), o = osc(m.r, m.v, MU_M); notes.loi2.orbit = { rp: o.rp - R_M, ra: o.ra - R_M }; notes.lunarIncl = Math.acos(dot(unit(o.h), M.moonAxes(t).z)) / D2R; }

    // ---- Undocking
    ({ t, s } = fly(M, stack, t, s, T.undock));
    evt(t, 'Undocking', 'Eagle undocks from Columbia.', 'lunar-orbit');
    s[6] = 1.67e4;
    let lmS = [...s.slice(0, 6), 1.522e4];
    { const up = unit(sub(s.slice(0, 3), M.moonPos(t))); lmS = [...lmS.slice(0, 3), ...add(lmS.slice(3, 6), mul(up, -0.0002)), 1.522e4]; }
    let tl = t; lmT.push(tl, lmS);

    // DOI timing: LM perilune (half a rev after DOI) should be `downrange` deg uprange of the site
    const DR = P.downrange * D2R;
    let tDoi = null;
    {
      let prev = null;
      fly(M, null, tl, lmS, T.doi + 8000, {
        dt: 5, post: (t2, s2) => {
          if (tDoi || t2 < T.doi - 3000) { prev = null; return; }
          const m = moonRel(M, t2, s2), hU = unit(cross(m.r, m.v));
          const a = angAlong(m.r, sub(siteAt(t2 + 3500), M.moonPos(t2 + 3500)), hU); // LM angle relative to site (neg = behind)
          const d = wrap(a - (Math.PI - DR));
          if (prev !== null && Math.sign(prev) !== Math.sign(d) && Math.abs(d) < 0.5) tDoi = t2 - 5 * d / (d - prev);
          prev = d;
        }, stop: () => !!tDoi,
      });
    }
    // refine: the perilune after DOI must fall DR uprange of the site (the pre-DOI orbit is not quite circular)
    {
      const outcome = (tD) => {
        const q = fly(M, null, tl, lmS, tD);
        const b = burn(M, null, q.t, q.s, ENG.DPS, (tt, ss) => mul(unit(moonRel(M, tt, ss).v), -1), (tt, ss) => { const m = moonRel(M, tt, ss); return osc(m.r, m.v, MU_M).rp <= R_M + 15.2; }, { dt: 0.1, throttle: 0.1 });
        const pe = findPeri(M, b.t + 300, fly(M, null, b.t, b.s, b.t + 300).s, 'moon', b.t + 8000);
        const m = moonRel(M, pe.t, pe.s), hU = unit(cross(m.r, m.v));
        return wrap(angAlong(m.r, sub(siteAt(pe.t + 750), M.moonPos(pe.t + 750)), hU) + DR);
      };
      let x0 = tDoi, f0 = outcome(x0), x1 = tDoi + 60, f1 = outcome(x1);
      for (let k = 0; k < 8 && Math.abs(f1) > 1e-5; k++) { const x2 = x1 - f1 * (x1 - x0) / (f1 - f0); x0 = x1; f0 = f1; x1 = x2; f1 = outcome(x1); }
      tDoi = x1; notes.doiRefine = f1;
    }
    ({ t: tl, s: lmS } = fly(M, lmT, tl, lmS, tDoi));
    evt(tl, 'DOI', 'Descent Orbit Insertion.', 'descent');
    r = burn(M, lmT, tl, lmS, ENG.DPS, (tt, ss) => mul(unit(moonRel(M, tt, ss).v), -1), (tt, ss) => { const m = moonRel(M, tt, ss); return osc(m.r, m.v, MU_M).rp <= R_M + 15.2; }, { dt: 0.1, throttle: 0.1 });
    ({ t: tl, s: lmS } = r); notes.doiBurn = { dv: r.dv, dur: tl - tDoi };
    const pdi = findPeri(M, tl + 300, fly(M, null, tl, lmS, tl + 300).s, 'moon', tl + 8000);
    ({ t: tl, s: lmS } = fly(M, lmT, tl, lmS, pdi.t));
    const tPdi = tl;
    { const m = moonRel(M, tl, lmS), hU = unit(cross(m.r, m.v)); notes.pdiAng = angAlong(m.r, sub(siteAt(tl + 700), M.moonPos(tl + 700)), hU) / D2R; notes.doiT = tDoi; }
    evt(tl, 'PDI', 'Powered Descent Initiation.', 'descent');

    // ---- Powered descent: P63 braking (thrust-limited, vertical + crossrange channels), P64/P66 jerk targeting
    const hOrb = (() => { const m = moonRel(M, tPdi, lmS); return unit(cross(m.r, m.v)); })();
    const gates = [[-7.9, 2.29, 0.155, -0.046], [-0.20, 0.150, 0.020, -0.005], [0, 0.0017, 0, -0.0009]];
    const gateState = (tg, g) => {
      const sr = sub(siteAt(tg), M.moonPos(tg)), up = unit(sr);
      const fwd = unit(cross(hOrb, up)), ang = g[0] / R_M;
      const rel = mul(add(mul(up, Math.cos(ang)), mul(fwd, Math.sin(ang))), R_M + g[1]);
      const lup = unit(rel), lfwd = unit(cross(hOrb, lup));
      const vel = add(add(add(mul(lfwd, g[2]), mul(lup, g[3])), M.moonVel(tg)), M.moonRot(tg, add(rel, M.moonPos(tg))));
      return { pos: add(M.moonPos(tg), rel), vel };
    };
    const dps = ENG.DPS;
    let gi = 0; const tGate = [0, 0, 0], phaseT = [];
    const guidance = (tt, ss, Tg, g) => { const gs = gateState(tt + Tg, g); return sub(jerkTarget(ss.slice(0, 3), ss.slice(3, 6), gs.pos, gs.vel, Tg), M.grav(tt, ss.slice(0, 3))); };
    const braking = (tt, ss) => {
      const r = ss.slice(0, 3), v = ss.slice(3, 6), rel = sub(r, M.moonPos(tt)), rn = norm(rel), up = unit(rel);
      const vrel = sub(sub(v, M.moonVel(tt)), M.moonRot(tt, r));
      const fwd = unit(cross(hOrb, up)), vz = dot(vrel, up), vh = dot(vrel, fwd), alt = rn - R_M;
      const a = (tt - tPdi < 26 ? 0.1 : (P.brakeThr || 0.88)) * dps.F / ss[6] / 1000, g0 = gates[0];
      const tgo = Math.max(20, (vh - g0[2]) / (a * 0.97));
      const gEff = MU_M / rn ** 2 - (dot(sub(v, M.moonVel(tt)), fwd) ** 2) / rn;
      const aV = Math.max(-0.4 * a, Math.min(0.9 * a, jerk1(alt, vz, g0[1], g0[3], tgo) + gEff));
      // crossrange: steer onto the plane through the site parallel to the orbit
      const siteOff = dot(sub(siteAt(tt + tgo), M.moonPos(tt + tgo)), hOrb), xc = dot(rel, hOrb), vc = dot(vrel, hOrb);
      const aC = Math.max(-0.25 * a, Math.min(0.25 * a, jerk1(xc, vc, siteOff, 0, tgo + 60)));
      const aH = Math.sqrt(Math.max(0, a * a - aV * aV - aC * aC));
      return { thrA: add(add(mul(up, aV), mul(fwd, -aH)), mul(hOrb, aC)), vh };
    };
    const descentCtrl = (tt, ss) => {
      let thrA;
      if (gi === 0) thrA = braking(tt, ss).thrA;
      else {
        const Tg = tGate[gi] - tt;
        if (gi === 2 && Tg < 22) {
          const r = ss.slice(0, 3), v = ss.slice(3, 6), up = unit(sub(r, M.moonPos(tt)));
          const vrel = sub(sub(v, M.moonVel(tt)), M.moonRot(tt, r)), vz = dot(vrel, up), vhv = sub(vrel, mul(up, vz));
          thrA = sub(add(mul(vhv, -1 / 4), mul(up, (-0.0009 - vz) / 3)), M.grav(tt, r));
        } else thrA = guidance(tt, ss, Math.max(Tg, 6), gates[gi]);
      }
      const F = Math.max(dps.min, Math.min(dps.F, norm(thrA) * ss[6] * 1000));
      return { acc: mul(unit(thrA), F / ss[6] / 1000), mdot: F / (dps.isp * G), F };
    };
    ({ t: tl, s: lmS } = fly(M, lmT, tl, lmS, tl + 1500, {
      dt: 0.25, ctrl: descentCtrl,
      post: (tt, ss) => {
        if (gi === 0 && braking(tt, ss).vh <= gates[0][2]) {
          gi = 1; tGate[0] = tt; tGate[1] = tt + 150; tGate[2] = tt + 248; phaseT.push(tt);
          const g = gateState(tt, gates[0]); notes.highGate = { err: norm(sub(ss.slice(0, 3), g.pos)), alongErr: dot(sub(ss.slice(0, 3), g.pos), unit(cross(hOrb, unit(sub(g.pos, M.moonPos(tt)))))), alt: norm(sub(ss.slice(0, 3), M.moonPos(tt))) - R_M };
        } else if (gi === 1 && tt >= tGate[1]) { gi = 2; phaseT.push(tt); }
      },
      stop: (tt, ss) => norm(sub(ss.slice(0, 3), M.moonPos(tt))) - R_M <= 0.0005,
    }));
    const touch = tl;
    notes.touchdown = { pdi: tPdi, phases: phaseT.map((x) => x - tPdi), dur: touch - tPdi, t: touch, err: norm(sub(lmS.slice(0, 3), siteAt(tl))), mass: lmS[6], v: norm(sub(sub(lmS.slice(3, 6), M.moonVel(tl)), M.moonRot(tl, lmS.slice(0, 3)))) };
    evt(phaseT[0] || tPdi + 507, 'P64 approach', 'High gate: the landing site comes into view.', 'descent');
    evt(tPdi + 317, '1202 alarm', 'Executive overflow.', 'descent');
    evt(touch, 'Touchdown', '"Houston, Tranquility Base here. The Eagle has landed."', 'surface');
    evt(T.eva, 'First step', '"That\'s one small step for [a] man, one giant leap for mankind."', 'surface');
    const surfaceState = (tt, m) => { const p = siteAt(tt); return [...p, ...add(M.moonVel(tt), M.moonRot(tt, p)), m]; };
    for (let tt = touch + 30; tt < T.lmLiftoff + 3600; tt += 60) lmT.push(tt, surfaceState(tt, lmS[6]));
    if (opts.descentOnly) return { M, notes, lmT, siteAt };

    // ---- CSM coasts to docking
    ({ t, s } = fly(M, stack, t, s, T.docking));
    const csmDock = s;
    const csmAt = (tt) => { const q = stack.at(tt); return [...q.p, ...q.v]; };

    // ---- LM ascent into the CSM's plane
    const aps = ENG.APS;
    const ascend = (tLift, track) => {
      let ss = surfaceState(tLift, 4.80e3), tt = tLift; if (track) track.push(tt, ss);
      const cm = moonRel(M, tLift, csmAt(tLift)), csmH = unit(cross(cm.r, cm.v));
      const hT = 18.3, vzT = 0.010;
      const ctrl = (t2, s2) => {
        const m = moonRel(M, t2, s2), rn = norm(m.r), up = unit(m.r), fwd = unit(cross(csmH, up));
        const vz = dot(m.v, up), vh = dot(m.v, fwd), alt = rn - R_M, xc = dot(m.r, csmH), vc = dot(m.v, csmH);
        const a = aps.F / s2[6] / 1000;
        let sinP = 1, sinL = 0;
        if (t2 - tLift >= 10) {
          const vT = Math.sqrt(MU_M * (2 / (R_M + hT) - 1 / ((2 * R_M + hT + 83.3) / 2)));
          const tgo = Math.max(15, (vT - vh) / a * 0.97);
          const gEff = MU_M / rn ** 2 - vh * vh / rn;
          sinP = Math.max(-0.5, Math.min(0.95, (jerk1(alt, vz, hT, vzT, tgo) + gEff) / a));
          sinL = Math.max(-0.3, Math.min(0.3, jerk1(xc, vc, 0, 0, tgo) / a));
        }
        const dir = add(add(mul(up, sinP), mul(fwd, Math.sqrt(Math.max(0, 1 - sinP * sinP - sinL * sinL)))), mul(csmH, sinL));
        return { acc: mul(dir, a), mdot: aps.F / (aps.isp * G) };
      };
      return fly(M, track, tt, ss, tt + 1200, { dt: 0.25, ctrl, stop: (t2, s2) => { const m = moonRel(M, t2, s2); return osc(m.r, m.v, MU_M).ra >= R_M + 83.3; } });
    };
    // liftoff when the CSM leads the site by the right angle (LM ~450 km behind at insertion)
    let best = null;
    for (let tL = T.lmLiftoff - 3600; tL <= T.lmLiftoff + 3600; tL += 30) {
      const ins = tL + 430, c = csmAt(ins), m = moonRel(M, ins, c), hU = unit(cross(m.r, m.v));
      const lead = angAlong(m.r, sub(siteAt(ins), M.moonPos(ins)), hU) / D2R;
      const err = Math.abs(wrap((lead - 23.8) * D2R));
      if (!best || err < best.err) best = { tL, err };
    }
    const tLift = best.tL;
    while (lmT.t.length && lmT.t[lmT.t.length - 1] >= tLift) { lmT.t.pop(); lmT.x.length -= 6; lmT.mass.pop(); }
    evt(tLift, 'Lunar liftoff', 'Eagle\'s ascent stage lifts off.', 'ascent');
    let a = ascend(tLift, lmT); tl = a.t; lmS = a.s;
    { const m = moonRel(M, tl, lmS), o = osc(m.r, m.v, MU_M); notes.ascent = { dur: tl - tLift, rp: o.rp - R_M, ra: o.ra - R_M, gap: norm(sub(lmS.slice(0, 3), csmAt(tl).slice(0, 3))) }; }
    evt(tl, 'Ascent insertion', 'Eagle in lunar orbit, trailing Columbia.', 'rendezvous');
    const tCSI = C.H(125, 19, 35);
    ({ t: tl, s: lmS } = fly(M, lmT, tl, lmS, tCSI));
    evt(tCSI, 'CSI', 'Co-elliptic Sequence Initiation.', 'rendezvous');
    evt(C.H(126, 17, 46), 'CDH', 'Constant Delta Height burn.', 'rendezvous');
    evt(T.tpi, 'TPI', 'Terminal Phase Initiation.', 'rendezvous');
    {
      const t0 = tCSI, t1 = T.docking, D = t1 - t0, coast = new Track('tmp');
      coast.push(tl, lmS); fly(M, coast, tl, lmS, t1 + 10);
      for (let tt = t0 + 10; tt <= t1 + 1e-6; tt += 10) {
        const u = (tt - t0) / D, w = u * u * u * (u * (u * 6 - 15) + 10), dw = 30 * u * u * (u - 1) * (u - 1) / D;
        const A = coast.at(tt), Bs = stack.at(tt);
        lmT.push(tt, [...add(mul(A.p, 1 - w), mul(Bs.p, w)), ...add(add(mul(A.v, 1 - w), mul(Bs.v, w)), mul(sub(Bs.p, A.p), dw)), lmS[6]]);
      }
    }
    evt(T.docking, 'Docking', 'Eagle and Columbia re-dock.', 'lunar-orbit');
    t = T.docking; s = [...csmDock.slice(0, 6), 1.67e4];
    ({ t, s } = fly(M, stack, t, s, T.lmJett));
    for (let tt = T.docking + 10; tt < T.lmJett; tt += 10) { const q = stack.at(tt); lmT.push(tt, [...q.p, ...q.v, 2.4e3]); }
    evt(T.lmJett, 'LM jettison', 'Eagle\'s ascent stage is released.', 'lunar-orbit');
    { const ss = [...s.slice(0, 3), ...add(s.slice(3, 6), mul(unit(sub(s.slice(0, 3), M.moonPos(t))), 0.0003)), 2.4e3]; lmT.push(T.lmJett, ss); fly(M, lmT, T.lmJett, ss, T.lmJett + 4 * 3600); }

    // ---- TEI (real ignition time), steered prograde with pitch/yaw, exact dv cutoff
    ({ t, s } = fly(M, stack, t, s, T.tei));
    evt(t, 'TEI', 'Trans-Earth Injection.', 'transearth');
    r = burn(M, stack, t, s, ENG.SPS, (tt, ss) => { const m = moonRel(M, tt, ss); return steer(m.v, m.r, P.tei[1], P.tei[2]); }, null, { dt: 0.5, dvTarget: P.tei[0] });
    ({ t, s } = r); notes.tei = { dv: r.dv, dur: t - T.tei };
    if (opts.coastOnly) {
      // coast to 40,000 km from Earth on the way in, then take the perigee analytically (Kepler) for smooth targeting
      const q = fly(M, null, t, s, t + 100 * 3600, { stop: (tt, ss) => norm(ss.slice(0, 3)) < 40000 && dot(ss.slice(0, 3), ss.slice(3, 6)) < 0 });
      const rr = q.s.slice(0, 3), vv = q.s.slice(3, 6), rn = norm(rr), h = cross(rr, vv);
      const eV = sub(mul(cross(vv, h), 1 / MU_E), mul(rr, 1 / rn)), e = norm(eV), en = dot(vv, vv) / 2 - MU_E / rn, a = -MU_E / (2 * en);
      const rp = a * (1 - e), cosNu = dot(unit(eV), unit(rr)) , nu = -Math.acos(Math.max(-1, Math.min(1, cosNu)));
      let dtp;
      if (e < 1) { const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2)); const Mn = E - e * Math.sin(E); dtp = -Mn / Math.sqrt(MU_E / a ** 3); }
      else { const Hh = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2)); const Mn = e * Math.sinh(Hh) - Hh; dtp = -Mn / Math.sqrt(MU_E / (-a) ** 3); }
      const tp = q.t + dtp, pp = mul(unit(eV), rp);
      notes.earthPeri = { t: tp, alt: rp - R_E, ll: M.latLonOf(tp, pp) };
      return { M, notes };
    }

    // ---- coast, CM/SM sep, entry
    ({ t, s } = fly(M, stack, t, s, T.cmSep));
    evt(t, 'CM/SM separation', 'The Service Module is jettisoned.', 'entry');
    s[6] = 5557;
    ({ t, s } = fly(M, stack, t, s, t + 30000, { stop: (tt, ss) => norm(ss.slice(0, 3)) - R_E <= 121.92 }));
    const vrelEI = sub(s.slice(3, 6), cross([0, 0, W_E], s.slice(0, 3)));
    notes.ei = { t, v: norm(s.slice(3, 6)), vRel: norm(vrelEI), fpa: Math.asin(dot(unit(s.slice(0, 3)), unit(s.slice(3, 6)))) / D2R, ll: M.latLonOf(t, s) };
    evt(t, 'Entry interface', 'Columbia meets the atmosphere at 122 km.', 'entry');
    let chute = 0, drogueT = 0, mainT = 0, maxG = 0;
    const entryCtrl = (tt, ss) => {
      const r = ss.slice(0, 3), v = ss.slice(3, 6), alt = norm(r) - R_E;
      const vrel = sub(v, cross([0, 0, W_E], r)), vr = norm(vrel);
      const rho = 1.225 * Math.exp(-Math.max(alt, 0) / 7.15), q = 0.5 * rho * (vr * 1000) ** 2;
      let CdA = 1.29 * 12.02, LD = 0.30;
      if (chute === 1) { CdA = 1.2 * 2 * 18; LD = 0; } if (chute === 2) { CdA = 0.8 * 3 * 455; LD = 0; }
      const D = q * CdA / ss[6] / 1000, up = unit(r), vU = unit(vrel);
      const liftDir = unit(sub(up, mul(vU, dot(up, vU)))), hdot = dot(vrel, up);
      let cosB = hdot > 0.03 ? -0.5 : (alt < 60 ? 0.6 : 1.0); if (vr < 2.5) cosB = 0;
      return { acc: add(mul(vU, -D), mul(liftDir, D * LD * cosB)), mdot: 0 };
    };
    const tEI = t;
    ({ t, s } = fly(M, stack, t, s, t + 4000, {
      dt: 0.2, ctrl: entryCtrl,
      post: (tt, ss) => {
        const alt = norm(ss.slice(0, 3)) - R_E, gl = norm(entryCtrl(tt, ss).acc) * 1000 / G; if (gl > maxG) maxG = gl;
        if (chute === 0 && alt < 7.3 && norm(sub(ss.slice(3, 6), cross([0, 0, W_E], ss.slice(0, 3)))) < 0.25) { chute = 1; drogueT = tt; }
        if (chute === 1 && alt < 3.2) { chute = 2; mainT = tt; }
      },
      stop: (tt, ss) => norm(ss.slice(0, 3)) - R_E <= 0,
    }));
    notes.entry = { maxG, drogueT, mainT, splash: t, dur: t - tEI, ll: M.latLonOf(t, s) };
    if (opts.entryOnly) return { M, notes };
    if (drogueT) evt(drogueT, 'Drogue chutes', 'Drogue parachutes deploy.', 'entry');
    if (mainT) evt(mainT, 'Main chutes', 'Main parachutes open.', 'entry');
    evt(t, 'Splashdown', 'Columbia splashes down in the Pacific.', 'recovery');
    ev.sort((x, y) => x.t - y.t);
    return { M, ev, notes, tracks: { stack, lm: lmT, sivb }, site };
  }

  root.MissionBuilder = { build, launch, findPeri, model };
  if (typeof module !== 'undefined') module.exports = root.MissionBuilder;
})(typeof window !== 'undefined' ? window : globalThis);
