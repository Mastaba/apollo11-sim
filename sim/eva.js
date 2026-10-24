// SPDX-License-Identifier: GPL-2.0-or-later
// Part of the Apollo 11 simulator. Free software under the GNU GPL v2 or later; see the Licences section of the page.
// Apollo 11 EVA (moonwalk), scripted from the Apollo 11 Lunar Surface Journal timeline.
// Positions are metres east/north of the LM ladder side; heights in metres. Times are GET.
(function (root) {
  const H = (h, m, s) => h * 3600 + m * 60 + (s || 0);
  const EVA = {
    hatchOpen: H(109, 7, 33), hatchClose: H(111, 39, 13),
    // [time, east, north, height]; height > 0 means on the ladder/porch
    armstrong: [
      [H(109, 19, 16), -2.4, 0, 3.0], [H(109, 21, 0), -3.4, 0, 2.2], [H(109, 24, 0), -3.6, 0, 0.45], [H(109, 24, 15), -4.3, 0, 0],
      [H(109, 30, 0), -6.5, 1.5, 0], [H(109, 34, 0), -5.0, -1.0, 0], [H(109, 43, 0), -4.6, 0.8, 0],
      [H(109, 55, 0), -9, 9, 0], [H(110, 2, 0), -13.5, 17, 0], [H(110, 6, 0), -8, 3, 0], [H(110, 9, 0), -7.2, 2.4, 0],
      [H(110, 16, 0), -6, 1.6, 0], [H(110, 19, 0), -6, 1.6, 0], [H(110, 26, 0), -4.8, -1.2, 0], [H(110, 40, 0), -5.5, -2, 0],
      [H(110, 47, 0), -11.5, -12.5, 0], [H(111, 1, 0), -10, -14, 0], [H(111, 7, 0), 20, -8, 0], [H(111, 12, 0), 55, -6, 0],
      [H(111, 15, 0), 55, -6, 0], [H(111, 21, 0), -4.3, 0, 0], [H(111, 34, 0), -4.3, 0, 0], [H(111, 36, 30), -3.4, 0, 2.4], [H(111, 37, 30), -2.4, 0, 3.0],
    ],
    aldrin: [
      [H(109, 41, 28), -2.4, 0.3, 3.0], [H(109, 43, 0), -3.5, 0.3, 0.4], [H(109, 43, 16), -4.3, 0.4, 0],
      [H(109, 47, 0), -7, -2.5, 0], [H(109, 52, 0), -5.5, -4.2, 0], [H(110, 0, 0), -8.5, -1, 0], [H(110, 9, 0), -7.8, 3.6, 0],
      [H(110, 16, 0), -5.2, 2.4, 0], [H(110, 19, 0), -5.2, 2.4, 0], [H(110, 30, 0), -9.5, -5, 0], [H(110, 45, 0), -12, -12, 0],
      [H(110, 56, 0), -12.5, -15.5, 0], [H(111, 0, 0), -10, -16.5, 0], [H(111, 6, 0), -6.5, -3.5, 0], [H(111, 15, 0), -5.4, -4.4, 0],
      [H(111, 20, 0), -4.3, 0.3, 0], [H(111, 25, 0), -3.5, 0.3, 1.8], [H(111, 28, 0), -2.4, 0.3, 3.0],
    ],
    gear: {
      swc: { at: [-5.0, -4.6], from: H(109, 52, 0), to: H(111, 15, 0) },
      tv: { at: [-14.2, 18], from: H(110, 2, 0) },
      flag: { at: [-7.0, 3.0], from: H(110, 9, 0) },
      psep: { at: [-13.2, -15.6], from: H(110, 56, 0) },
      lrrr: { at: [-10.6, -17.2], from: H(110, 58, 0) },
    },
    events: [
      [H(109, 7, 33), 'Hatch open', 'Eagle\'s cabin is depressurised and the forward hatch opens.'],
      [H(109, 43, 16), 'Aldrin steps onto the Moon', '"Beautiful view." "Magnificent desolation."'],
      [H(109, 52, 0), 'Solar wind experiment', 'Aldrin unrolls a sheet of aluminium foil to catch particles streaming from the Sun.'],
      [H(110, 2, 0), 'TV camera placed', 'Armstrong carries the TV camera out onto its tripod so Earth can watch.'],
      [H(110, 9, 0), 'Flag planted', 'Armstrong and Aldrin raise the United States flag.'],
      [H(110, 16, 30), 'Call from the President', 'President Nixon speaks to the crew by radio-telephone from the White House.'],
      [H(110, 56, 0), 'Experiments deployed', 'A seismometer and a laser reflector are set up south of Eagle.'],
      [H(111, 8, 0), 'Little West crater', 'Armstrong lopes 60 m east to look into a crater nobody had planned to visit.'],
      [H(111, 39, 13), 'Hatch closed', 'Both crew are back inside Eagle after 2 hours 31 minutes outside.'],
    ],
  };
  // position, velocity (m/s) at time t along a key list; null when not outside
  EVA.at = (keys, t) => {
    if (t < keys[0][0] || t > keys[keys.length - 1][0]) return null;
    let i = 0; while (i < keys.length - 2 && keys[i + 1][0] < t) i++;
    const a = keys[i], b = keys[i + 1], u = Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0] || 1)));
    const s = u * u * (3 - 2 * u);
    const dt = b[0] - a[0] || 1, ve = (b[1] - a[1]) / dt, vn = (b[2] - a[2]) / dt;
    return { e: a[1] + (b[1] - a[1]) * s, n: a[2] + (b[2] - a[2]) * s, h: a[3] + (b[3] - a[3]) * s, ve, vn, speed: Math.hypot(ve, vn) * (u > 0 && u < 1 ? 1 : 0), seg: i, dist: 0 };
  };
  // footprints: sample each path every ~0.75 m on the ground
  EVA.footprints = () => {
    const out = [];
    for (const [who, keys] of [['A', EVA.armstrong], ['B', EVA.aldrin]]) {
      for (let i = 0; i < keys.length - 1; i++) {
        const a = keys[i], b = keys[i + 1]; if (a[3] > 0.05 || b[3] > 0.05) continue;
        const d = Math.hypot(b[1] - a[1], b[2] - a[2]), n = Math.floor(d / 0.75);
        for (let k = 1; k <= n; k++) {
          const u = k / n, s = u * u * (3 - 2 * u); // matches the smoothstep timing approximately
          const side = (k % 2 ? 1 : -1) * 0.12, dx = (b[1] - a[1]) / d, dy = (b[2] - a[2]) / d;
          out.push({ t: a[0] + (b[0] - a[0]) * u, e: a[1] + (b[1] - a[1]) * u - dy * side, n: a[2] + (b[2] - a[2]) * u + dx * side, yaw: Math.atan2(dx, dy), who });
        }
        void 0;
      }
    }
    return out.sort((x, y) => x.t - y.t);
  };
  root.EVA = EVA;
})(typeof window !== 'undefined' ? window : globalThis);
