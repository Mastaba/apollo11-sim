// SPDX-License-Identifier: GPL-2.0-or-later
// Part of the Apollo 11 simulator. Free software under the GNU GPL v2 or later; see the Licences section of the page.
// Apollo 11 flight dynamics, full 3D.
// Frame: geocentric, mean equator & equinox of date (July 1969); km, s; t = GET (s from liftoff).
// Moon & Sun: Meeus low-precision theories (Astronomical Algorithms ch. 25, 47).
// Earth: point mass + J2, rotating by GMST. Moon orientation: IAU WGCCRE model, precessed to date.
(function (root) {
  const MU_E = 398600.4418, MU_M = 4902.800, MU_S = 1.32712440018e11, R_E = 6378.137, R_M = 1737.4, J2 = 1.08263e-3;
  const AU = 149597870.7, W_E = 7.2921159e-5, D2R = Math.PI / 180;
  const D_M = 384400, N_M = 2.6617e-6;
  const JD0 = 2440419.0 + (13 + 32 / 60) / 24 - 0.5;   // 1969-07-16 13:32:00 UT
  const DT_TT = 39.7;                                  // TT - UT in 1969 (s)
  const H = (h, m, s) => h * 3600 + m * 60 + (s || 0);
  const T = {
    liftoff: 0, sicCutoff: 161.6, siiIgn: 165.3, siiCutoff: 548.2, insertion: 709.3,
    tliIgn: H(2, 44, 16), tliCutoff: H(2, 50, 3), tde: H(3, 17, 5), lmExtract: H(4, 17, 3),
    loi1: H(75, 49, 50), loi2: H(80, 11, 36), undock: H(100, 12, 0), doi: H(101, 36, 14),
    pdi: H(102, 33, 5), landing: H(102, 45, 40), eva: H(109, 24, 15), lmLiftoff: H(124, 22, 0),
    ascIns: H(124, 29, 15), tpi: H(127, 3, 30), docking: H(128, 3, 0), lmJett: H(130, 9, 31),
    tei: H(135, 23, 42), cmSep: H(194, 49, 12), ei: H(195, 3, 6), splash: H(195, 18, 35),
  };
  const SITES = { ksc: { lat: 28.6083, lon: -80.6041 }, tranq: { lat: 0.67408, lon: 23.47297 }, splash: { lat: 13.3167, lon: -169.15 } };

  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => Math.hypot(a[0], a[1], a[2]);
  const unit = (a) => mul(a, 1 / norm(a));
  const sind = (x) => Math.sin(x * D2R), cosd = (x) => Math.cos(x * D2R);

  // ---------- ephemerides ----------
  const jdUT = (t) => JD0 + t / 86400;
  const centuriesTT = (t) => (jdUT(t) + DT_TT / 86400 - 2451545.0) / 36525;
  const obliq = (Tc) => 23.439291 - 0.0130042 * Tc;
  const eclToEq = (lam, bet, r, Tc) => {
    const e = obliq(Tc), cb = cosd(bet);
    const x = r * cb * cosd(lam), y = r * cb * sind(lam), z = r * sind(bet);
    return [x, y * cosd(e) - z * sind(e), y * sind(e) + z * cosd(e)];
  };
  const LR = [[0,0,1,0,6288774,-20905355],[2,0,-1,0,1274027,-3699111],[2,0,0,0,658314,-2955968],[0,0,2,0,213618,-569925],[0,1,0,0,-185116,48888],[0,0,0,2,-114332,-3149],[2,0,-2,0,58793,246158],[2,-1,-1,0,57066,-152138],[2,0,1,0,53322,-170733],[2,-1,0,0,45758,-204586],[0,1,-1,0,-40923,-129620],[1,0,0,0,-34720,108743],[0,1,1,0,-30383,104755],[2,0,0,-2,15327,10321],[0,0,1,2,-12528,0],[0,0,1,-2,10980,79661],[4,0,-1,0,10675,-34782],[0,0,3,0,10034,-23210],[4,0,-2,0,8548,-21636],[2,1,-1,0,-7888,24208],[2,1,0,0,-6766,30824],[1,0,-1,0,-5163,-8379],[1,1,0,0,4987,-16675],[2,-1,1,0,4036,-12831],[2,0,2,0,3994,-10445],[4,0,0,0,3861,-11650],[2,0,-3,0,3665,14403],[0,1,-2,0,-2689,-7003],[2,0,-1,2,-2602,0],[2,-1,-2,0,2390,10056],[1,0,1,0,-2348,6322],[2,-2,0,0,2236,-9884],[0,1,2,0,-2120,5751],[0,2,0,0,-2069,0],[2,-2,-1,0,2048,-4950],[2,0,1,-2,-1773,4130],[2,0,0,2,-1595,0],[4,-1,-1,0,1215,-3958],[0,0,2,2,-1110,0],[3,0,-1,0,-892,3258],[2,1,1,0,-810,2616],[4,-1,-2,0,759,-1897],[0,2,-1,0,-713,-2117],[2,2,-1,0,-700,2354]];
  const B = [[0,0,0,1,5128122],[0,0,1,1,280602],[0,0,1,-1,277693],[2,0,0,-1,173237],[2,0,-1,1,55413],[2,0,-1,-1,46271],[2,0,0,1,32573],[0,0,2,1,17198],[2,0,1,-1,9266],[0,0,2,-1,8822],[2,-1,0,-1,8216],[2,0,-2,-1,4324],[2,0,1,1,4200],[2,1,0,-1,-3359],[2,-1,-1,1,2463],[2,-1,0,1,2211],[2,-1,-1,-1,2065],[0,1,-1,-1,-1870],[4,0,-1,-1,1828],[0,1,0,1,-1794],[0,0,0,3,-1749],[0,1,-1,1,-1565],[1,0,0,1,-1491],[0,1,1,1,-1475],[0,1,1,-1,-1410],[0,1,0,-1,-1344],[1,0,0,-1,-1335],[0,0,3,1,1107]];
  function moonEph(t) {
    const Tc = centuriesTT(t);
    const Lp = 218.3164477 + 481267.88123421 * Tc, Dd = 297.8501921 + 445267.1114034 * Tc, Ms = 357.5291092 + 35999.0502909 * Tc;
    const Mm = 134.9633964 + 477198.8675055 * Tc, F = 93.2720950 + 483202.0175233 * Tc, E = 1 - 0.002516 * Tc;
    const A1 = 119.75 + 131.849 * Tc, A2 = 53.09 + 479264.290 * Tc, A3 = 313.45 + 481266.484 * Tc;
    let sl = 0, sr = 0, sb = 0;
    for (const [d, m, mp, f, cl, cr] of LR) { const a = d * Dd + m * Ms + mp * Mm + f * F, e = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1; sl += cl * e * sind(a); sr += cr * e * cosd(a); }
    for (const [d, m, mp, f, cb] of B) { const a = d * Dd + m * Ms + mp * Mm + f * F, e = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1; sb += cb * e * sind(a); }
    sl += 3958 * sind(A1) + 1962 * sind(Lp - F) + 318 * sind(A2);
    sb += -2235 * sind(Lp) + 382 * sind(A3) + 175 * sind(A1 - F) + 175 * sind(A1 + F) + 127 * sind(Lp - Mm) - 115 * sind(Lp + Mm);
    return eclToEq(Lp + sl / 1e6, sb / 1e6, 385000.56 + sr / 1000, Tc);
  }
  function sunEph(t) {
    const Tc = centuriesTT(t);
    const L0 = 280.46646 + 36000.76983 * Tc, M = 357.52911 + 35999.05029 * Tc, e = 0.016708634 - 0.000042037 * Tc;
    const Cc = (1.914602 - 0.004817 * Tc) * sind(M) + (0.019993 - 0.000101 * Tc) * sind(2 * M) + 0.000289 * sind(3 * M);
    const nu = M + Cc, R = 1.000001018 * (1 - e * e) / (1 + e * cosd(nu));
    return eclToEq(L0 + Cc, 0, R * AU, Tc);
  }
  // Greenwich mean sidereal time (rad), Meeus 12.4
  function gmst(t) {
    const jd = jdUT(t), Tc = (jd - 2451545.0) / 36525;
    const th = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * Tc * Tc - Tc * Tc * Tc / 38710000;
    return (((th % 360) + 360) % 360) * D2R;
  }
  // Precession J2000 -> mean of date (Meeus 21.2), applied to the IAU Moon orientation
  function precessMatrix(Tc) {
    const as = D2R / 3600, ze = (2306.2181 * Tc + 0.30188 * Tc * Tc + 0.017998 * Tc ** 3) * as;
    const z = (2306.2181 * Tc + 1.09468 * Tc * Tc + 0.018203 * Tc ** 3) * as, th = (2004.3109 * Tc - 0.42665 * Tc * Tc - 0.041833 * Tc ** 3) * as;
    const cA = Math.cos(ze), sA = Math.sin(ze), cB = Math.cos(z), sB = Math.sin(z), cC = Math.cos(th), sC = Math.sin(th);
    return [[cA * cC * cB - sA * sB, -sA * cC * cB - cA * sB, -sC * cB], [cA * cC * sB + sA * cB, -sA * cC * sB + cA * cB, -sC * sB], [cA * sC, -sA * sC, cC]];
  }
  const mv = (Mx, v) => [Mx[0][0] * v[0] + Mx[0][1] * v[1] + Mx[0][2] * v[2], Mx[1][0] * v[0] + Mx[1][1] * v[1] + Mx[1][2] * v[2], Mx[2][0] * v[0] + Mx[2][1] * v[1] + Mx[2][2] * v[2]];
  const PREC = precessMatrix(centuriesTT(0));
  function moonAxesRaw(t) {
    const d = jdUT(t) + DT_TT / 86400 - 2451545.0, Tc = d / 36525;
    const E = [0, 125.045 - 0.0529921 * d, 250.089 - 0.1059842 * d, 260.008 + 13.0120009 * d, 176.625 + 13.3407154 * d, 357.529 + 0.9856003 * d, 311.589 + 26.4057084 * d, 134.963 + 13.0649930 * d, 276.617 + 0.3287146 * d, 34.226 + 1.7484877 * d, 15.134 - 0.1589763 * d, 119.743 + 0.0036096 * d, 239.961 + 0.1643573 * d, 25.053 + 12.9590088 * d];
    const s = (i) => sind(E[i]), c = (i) => cosd(E[i]);
    const a0 = 269.9949 + 0.0031 * Tc - 3.8787 * s(1) - 0.1204 * s(2) + 0.0700 * s(3) - 0.0172 * s(4) + 0.0072 * s(6) - 0.0052 * s(10) + 0.0043 * s(13);
    const d0 = 66.5392 + 0.0130 * Tc + 1.5419 * c(1) + 0.0239 * c(2) - 0.0278 * c(3) + 0.0068 * c(4) - 0.0029 * c(6) + 0.0009 * c(7) + 0.0008 * c(10) - 0.0009 * c(13);
    const W = 38.3213 + 13.17635815 * d - 1.4e-12 * d * d + 3.5610 * s(1) + 0.1208 * s(2) - 0.0642 * s(3) + 0.0158 * s(4) + 0.0252 * s(5) - 0.0066 * s(6) - 0.0047 * s(7) - 0.0046 * s(8) + 0.0028 * s(9) + 0.0052 * s(10) + 0.0040 * s(11) + 0.0019 * s(12) - 0.0044 * s(13);
    // body->J2000: Rz(a0+90) Rx(90-d0) Rz(W)
    const rot = (v) => {
      let [x, y, z] = v; const w = W * D2R; [x, y] = [x * Math.cos(w) - y * Math.sin(w), x * Math.sin(w) + y * Math.cos(w)];
      const a = (90 - d0) * D2R; [y, z] = [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
      const b = (a0 + 90) * D2R; [x, y] = [x * Math.cos(b) - y * Math.sin(b), x * Math.sin(b) + y * Math.cos(b)];
      return mv(PREC, [x, y, z]);
    };
    return { x: rot([1, 0, 0]), y: rot([0, 1, 0]), z: rot([0, 0, 1]) };
  }

  // ---------- model with cached ephemerides ----------
  function makeModel() {
    const t0 = -7200, step = 300, n = Math.ceil((216 * 3600 - t0) / step) + 2;
    const MP = new Float64Array(n * 3), MV = new Float64Array(n * 3), SP = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * step, p = moonEph(t), a = moonEph(t - 20), b = moonEph(t + 20), s = sunEph(t);
      MP.set(p, i * 3); MV.set(mul(sub(b, a), 1 / 40), i * 3); SP.set(s, i * 3);
    }
    const herm = (t, P, V) => {
      const x = (t - t0) / step, i = Math.max(0, Math.min(n - 2, Math.floor(x))), u = x - i, h = step;
      const h00 = 2 * u ** 3 - 3 * u * u + 1, h10 = u ** 3 - 2 * u * u + u, h01 = -2 * u ** 3 + 3 * u * u, h11 = u ** 3 - u * u;
      const a = i * 3, b = a + 3;
      return [0, 1, 2].map((k) => h00 * P[a + k] + h10 * h * V[a + k] + h01 * P[b + k] + h11 * h * V[b + k]);
    };
    const hermV = (t) => {
      const x = (t - t0) / step, i = Math.max(0, Math.min(n - 2, Math.floor(x))), u = x - i, h = step, a = i * 3, b = a + 3;
      const d00 = (6 * u * u - 6 * u) / h, d10 = 3 * u * u - 4 * u + 1, d01 = (-6 * u * u + 6 * u) / h, d11 = 3 * u * u - 2 * u;
      return [0, 1, 2].map((k) => d00 * MP[a + k] + d10 * MV[a + k] + d01 * MP[b + k] + d11 * MV[b + k]);
    };
    const lin = (t, P) => { const x = (t - t0) / step, i = Math.max(0, Math.min(n - 2, Math.floor(x))), u = x - i; return [0, 1, 2].map((k) => P[i * 3 + k] * (1 - u) + P[i * 3 + 3 + k] * u); };
    const moonPos = (t) => herm(t, MP, MV), moonVel = hermV, sunPos = (t) => lin(t, SP);
    function grav(t, r) {
      const rm = moonPos(t), rs = sunPos(t), d = sub(r, rm), ds = sub(r, rs);
      const re = norm(r), rd = norm(d), rmn = norm(rm), rdn = norm(ds), rsn = norm(rs);
      const z2 = (r[2] / re) ** 2, k = 1.5 * J2 * MU_E * R_E * R_E / re ** 5;
      const out = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        out[i] = -MU_E * r[i] / re ** 3 - MU_M * (d[i] / rd ** 3 + rm[i] / rmn ** 3) - MU_S * (ds[i] / rdn ** 3 + rs[i] / rsn ** 3);
      }
      out[0] += k * r[0] * (5 * z2 - 1); out[1] += k * r[1] * (5 * z2 - 1); out[2] += k * r[2] * (5 * z2 - 3);
      return out;
    }
    const moonAxes = moonAxesRaw;
    const selenoToECI = (t, lat, lon, alt) => {
      const ax = moonAxes(t), r = R_M + (alt || 0), cl = cosd(lat);
      return add(moonPos(t), add(add(mul(ax.x, r * cl * cosd(lon)), mul(ax.y, r * cl * sind(lon))), mul(ax.z, r * sind(lat))));
    };
    const moonRot = (t, p) => cross(mul(moonAxes(t).z, 2.6617e-6), sub(p, moonPos(t))); // velocity of a seleno-fixed point rel. Moon centre
    const geoToECI = (t, lat, lon, alt) => { const th = gmst(t) + lon * D2R, r = R_E + (alt || 0); return [r * cosd(lat) * Math.cos(th), r * cosd(lat) * Math.sin(th), r * sind(lat)]; };
    const latLonOf = (t, p) => { const th = gmst(t), x = p[0] * Math.cos(-th) - p[1] * Math.sin(-th), y = p[0] * Math.sin(-th) + p[1] * Math.cos(-th); return { lat: Math.atan2(p[2], Math.hypot(x, y)) / D2R, lon: Math.atan2(y, x) / D2R }; };
    const sunDir = (t) => unit(sunPos(t));
    return { moonPos, moonVel, sunPos, sunDir, grav, moonAxes, selenoToECI, moonRot, gmst, geoToECI, latLonOf };
  }

  function osc(r, v, mu) {
    const rn = norm(r), vn = norm(v), en = vn * vn / 2 - mu / rn, a = -mu / (2 * en);
    const h = cross(r, v), e = Math.sqrt(Math.max(0, 1 + 2 * en * dot(h, h) / (mu * mu)));
    return { a, e, rp: a * (1 - e), ra: e < 1 ? a * (1 + e) : Infinity, h };
  }
  function rk4(model, t, s, dt, ctrl) {
    const f = (tt, ss) => {
      const g = model.grav(tt, ss); const c = ctrl ? ctrl(tt, ss) : null;
      let ax = g[0], ay = g[1], az = g[2], md = 0;
      if (c) { ax += c.acc[0]; ay += c.acc[1]; az += c.acc[2]; md = c.mdot || 0; }
      return [ss[3], ss[4], ss[5], ax, ay, az, -md];
    };
    const k1 = f(t, s), s2 = s.map((x, i) => x + k1[i] * dt / 2), k2 = f(t + dt / 2, s2);
    const s3 = s.map((x, i) => x + k2[i] * dt / 2), k3 = f(t + dt / 2, s3), s4 = s.map((x, i) => x + k3[i] * dt), k4 = f(t + dt, s4);
    return s.map((x, i) => x + dt * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) / 6);
  }
  function autoStep(model, t, s) {
    const r = s.slice(0, 3), re = norm(r), rm = norm(sub(r, model.moonPos(t)));
    return Math.max(0.5, Math.min(240, 0.004 * Math.min(re ** 1.5 / Math.sqrt(MU_E), rm ** 1.5 / Math.sqrt(MU_M))));
  }
  function fly(model, track, t, s, tEnd, opt = {}) {
    const ctrl = opt.ctrl || null, stop = opt.stop || null, dtFix = opt.dt || 0;
    while (t < tEnd - 1e-9) {
      let dt = dtFix || autoStep(model, t, s);
      if (t + dt > tEnd) dt = tEnd - t;
      const ns = rk4(model, t, s, dt, ctrl);
      if (opt.post) opt.post(t + dt, ns);
      t += dt; s = ns;
      if (track) track.push(t, s);
      if (stop && stop(t, s)) break;
    }
    return { t, s };
  }
  class Track {
    constructor(name) { this.name = name; this.t = []; this.x = []; this.mass = []; }
    push(t, s) { if (this.t.length && t <= this.t[this.t.length - 1]) return; this.t.push(t); this.x.push(s[0], s[1], s[2], s[3], s[4], s[5]); this.mass.push(s[6] || 0); }
    get t0() { return this.t[0]; } get t1() { return this.t[this.t.length - 1]; }
    at(t) {
      const T = this.t, n = T.length; if (!n) return null;
      if (t <= T[0]) return this.sample(0); if (t >= T[n - 1]) return this.sample(n - 1);
      let lo = 0, hi = n - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T[mid] <= t) lo = mid; else hi = mid; }
      const h = T[hi] - T[lo], u = (t - T[lo]) / h, X = this.x, a = lo * 6, b = hi * 6;
      const h00 = 2 * u ** 3 - 3 * u * u + 1, h10 = u ** 3 - 2 * u * u + u, h01 = -2 * u ** 3 + 3 * u * u, h11 = u ** 3 - u * u;
      const d00 = (6 * u * u - 6 * u) / h, d10 = 3 * u * u - 4 * u + 1, d01 = (-6 * u * u + 6 * u) / h, d11 = 3 * u * u - 2 * u;
      const p = [], v = [];
      for (let i = 0; i < 3; i++) { p.push(h00 * X[a + i] + h10 * h * X[a + 3 + i] + h01 * X[b + i] + h11 * h * X[b + 3 + i]); v.push(d00 * X[a + i] + d10 * X[a + 3 + i] + d01 * X[b + i] + d11 * X[b + 3 + i]); }
      return { p, v, m: this.mass[lo] + (this.mass[hi] - this.mass[lo]) * u };
    }
    sample(i) { const X = this.x, a = i * 6; return { p: [X[a], X[a + 1], X[a + 2]], v: [X[a + 3], X[a + 4], X[a + 5]], m: this.mass[i] }; }
  }
  const ENG = {
    SIC: { F: 34.02e6, isp: 263 }, SII: { F: 5.10e6, isp: 421 }, SIVB: { F: 0.90e6, isp: 421 },
    SPS: { F: 91.19e3, isp: 314 }, DPS: { F: 45.04e3, isp: 311, min: 4.7e3 }, APS: { F: 15.57e3, isp: 311 },
  };
  function jerkTarget(r, v, rT, vT, Tg) {
    const j = mul(sub(mul(sub(vT, v), Tg / 2), sub(sub(rT, r), mul(v, Tg))), 12 / Tg ** 3);
    return sub(mul(sub(vT, v), 1 / Tg), mul(j, Tg / 2));
  }
  const jerk1 = (x, v, xT, vT, Tg) => { const j = 12 * ((vT - v) * Tg / 2 - (xT - x - v * Tg)) / Tg ** 3; return (vT - v) / Tg - j * Tg / 2; };

  root.MissionCore = { MU_E, MU_M, MU_S, R_E, R_M, D_M, N_M, W_E, J2, D2R, JD0, T, SITES, ENG, add, sub, mul, dot, cross, norm, unit, sind, cosd, makeModel, moonEph, sunEph, gmst, osc, rk4, fly, Track, jerkTarget, jerk1, H };
  if (typeof module !== 'undefined') module.exports = root.MissionCore;
})(typeof window !== 'undefined' ? window : globalThis);
