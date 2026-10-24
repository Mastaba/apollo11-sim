// SPDX-License-Identifier: GPL-2.0-or-later
// Part of the Apollo 11 simulator. Free software under the GNU GPL v2 or later; see the Licences section of the page.
// AGC: thin JS wrapper around Virtual AGC's yaAGC engine compiled to WebAssembly.
// Decodes DSKY output channels (010, 011, 0163) into digits and lamps.
(function (root) {
  const SEG = { 0: ' ', 21: '0', 3: '1', 25: '2', 27: '3', 15: '4', 30: '5', 28: '6', 19: '7', 29: '8', 31: '9' };
  const KEYS = { '0': 16, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    VERB: 17, RSET: 18, KEYREL: 25, '+': 26, '-': 27, ENTR: 28, CLR: 30, NOUN: 31 };
  const CYCLES_PER_SEC = (1024000 + 6) / 12; // 85,333 machine cycles/s

  function wasiStubs(getMem) {
    const ok = () => 0;
    return {
      fd_write(fd, iovs, n, nw) {
        const dv = new DataView(getMem().buffer); let t = 0;
        for (let i = 0; i < n; i++) t += dv.getUint32(iovs + 8 * i + 4, true);
        dv.setUint32(nw, t, true); return 0;
      },
      fd_close: ok, fd_fdstat_get: () => 8, fd_fdstat_set_flags: () => 8, fd_prestat_get: () => 8,
      fd_prestat_dir_name: () => 8, fd_read: () => 8, fd_seek: () => 8, path_open: () => 44,
      proc_exit(c) { throw new Error('AGC proc_exit ' + c); },
    };
  }

  class AGC {
    static async create(wasmBytes, romBytes, isCM) {
      let inst;
      const mod = await WebAssembly.instantiate(wasmBytes, {
        wasi_snapshot_preview1: wasiStubs(() => inst.exports.memory),
        env: new Proxy({}, { get: () => () => 0 }),
      });
      inst = mod.instance || mod;
      if (inst.exports._initialize) inst.exports._initialize();
      return new AGC(inst.exports, romBytes, isCM);
    }
    constructor(x, romBytes, isCM) {
      this.x = x; this.isCM = !!isCM;
      x.agc_set_cm(isCM ? 1 : 0);
      this.s = x.agc_new();
      const p = x.agc_alloc(romBytes.length);
      new Uint8Array(x.memory.buffer, p, romBytes.length).set(romBytes);
      x.agc_load_rom(this.s, p, romBytes.length);
      this.rows = new Array(16).fill(0);
      this.ch11 = 0; this.ch163 = 0; this.ch12 = 0; this.ch13 = 0; this.ch14 = 0;
      this.cduCmd = { x: 0, y: 0, z: 0 };
      this.outLog = [];
      this.onOutput = null;
    }
    get seconds() { return this.x.agc_cycles(this.s) / CYCLES_PER_SEC; }
    // Run for `sec` seconds of AGC time.
    run(sec) {
      let n = Math.round(sec * CYCLES_PER_SEC);
      while (n > 0) {
        const k = Math.min(n, 2000);
        this.x.agc_run(this.s, k); n -= k;
        this.drain();
      }
    }
    drain() {
      let v;
      while ((v = this.x.agc_out_pop()) >= 0) {
        const ch = (v >>> 16) & 0xffff, val = v & 0x7fff;
        if (ch === 0o10) this.rows[(val >> 11) & 15] = val;
        else if (ch === 0o11) this.ch11 = val;
        else if (ch === 0o163) this.ch163 = val;
        else if (ch === 0o12) this.ch12 = val;
        else if (ch === 0o13) this.ch13 = val;
        else if (ch === 0o14) this.ch14 = val;
        else if (ch >= 0o250 && ch <= 0o252) { // CDU drive output bursts (0x80|counter)
        }
        if (this.onOutput) this.onOutput(ch, val);
      }
    }
    key(name) { const c = KEYS[name]; if (c != null) this.x.agc_key(this.s, c); }
    pro(down) { this.x.agc_pro(this.s, down ? 1 : 0); }
    readIO(ch) { return this.x.agc_read_io(this.s, ch); }
    writeIO(ch, v) { this.x.agc_write_io(this.s, ch, v); }
    incr(counter, type) { this.x.agc_incr(this.s, counter, type); }
    erasable(bank, off) { return this.x.agc_erasable(this.s, bank, off); }
    // Decoded DSKY state.
    dsky() {
      const r = this.rows, d = (w, hi) => SEG[hi ? (w >> 5) & 31 : w & 31] ?? '?';
      const sgn = (a, b) => (r[a] & 0x400) ? '+' : (r[b] & 0x400) ? '-' : ' ';
      const flash = (this.ch163 & 0o40) !== 0;
      const r12 = r[12], lamp = (b) => (r12 & b) !== 0;
      return {
        prog: d(r[11], 1) + d(r[11], 0),
        verb: flash ? '  ' : d(r[10], 1) + d(r[10], 0),
        noun: flash ? '  ' : d(r[9], 1) + d(r[9], 0),
        r1: sgn(7, 6) + d(r[8], 0) + d(r[7], 1) + d(r[7], 0) + d(r[6], 1) + d(r[6], 0),
        r2: sgn(5, 4) + d(r[5], 1) + d(r[5], 0) + d(r[4], 1) + d(r[4], 0) + d(r[3], 1),
        r3: sgn(2, 1) + d(r[3], 0) + d(r[2], 1) + d(r[2], 0) + d(r[1], 1) + d(r[1], 0),
        compActy: (this.ch11 & 2) !== 0,
        lamps: {
          uplink: (this.ch11 & 4) !== 0, noAtt: lamp(0o10), stby: (this.ch163 & 0o400) !== 0,
          keyRel: (this.ch163 & 0o20) !== 0, oprErr: (this.ch163 & 0o100) !== 0,
          prioDisp: !this.isCM && lamp(1), noDap: !this.isCM && lamp(2),
          temp: (this.ch163 & 0o10) !== 0, gimbalLock: lamp(0o40), prog: lamp(0o400),
          restart: (this.ch163 & 0o200) !== 0, tracker: lamp(0o200),
          alt: !this.isCM && lamp(0o20), vel: !this.isCM && lamp(4),
        },
      };
    }
  }
  AGC.KEYS = KEYS; AGC.CYCLES_PER_SEC = CYCLES_PER_SEC;
  if (typeof module !== 'undefined') module.exports = AGC; else root.AGC = AGC;
})(this);
