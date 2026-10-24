#!/usr/bin/env python3
"""Build index.html: one self-contained page with the emulator, core ropes, textures and source embedded.
Run from anywhere:  python3 sim/build.py"""
import base64, gzip, io, os, zipfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)
txt = lambda *a: open(P(*a), encoding='utf-8').read()
gz64 = lambda *a: base64.b64encode(gzip.compress(open(P(*a), 'rb').read(), 9, mtime=0)).decode()
b64 = lambda *a: base64.b64encode(open(P(*a), 'rb').read()).decode()

def agc_source_zip():
    """Complete corresponding source for agc/agc.wasm (GPL), offered for download from the page."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for d, _, files in sorted(os.walk(P('agc'))):
            for f in sorted(files):
                if f == 'agc.wasm' or f.endswith('.o'): continue
                full = os.path.join(d, f)
                info = zipfile.ZipInfo('agc-source/' + os.path.relpath(full, P('agc')), (1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                z.writestr(info, open(full, 'rb').read())
    return base64.b64encode(buf.getvalue()).decode()

h = txt('sim', 'app.src.html')
for k, v in {'__WASM_B64__': gz64('agc', 'agc.wasm'), '__CM_B64__': gz64('ropes', 'Comanche055.bin'), '__LM_B64__': gz64('ropes', 'Luminary099.bin'),
             '__AGCJS__': txt('agc', 'agc.js'), '__MISSIONJS__': txt('sim', 'mission.js'), '__BUILDERJS__': txt('sim', 'builder.js'), '__APPJS__': txt('sim', 'app.js'),
             '__EDUJS__': txt('sim', 'edu.js'), '__EVAJS__': txt('sim', 'eva.js'),
             '__TEX_DAY__': b64('assets', 'textures', 'day.jpg'), '__TEX_NIGHT__': b64('assets', 'textures', 'night.jpg'), '__TEX_CLOUDS__': b64('assets', 'textures', 'clouds.jpg'),
             '__TEX_SPEC__': b64('assets', 'textures', 'spec.jpg'), '__TEX_MOON__': b64('assets', 'textures', 'moon.jpg')}.items():
    h = h.replace(k, v)
for k, v in {'__AGCSRC_B64__': agc_source_zip(), '__GPL_TEXT__': txt('licenses', 'GPL-2.0.txt'), '__MIT_TEXT__': txt('licenses', 'three.js-MIT.txt')}.items():
    assert '</script' not in v.lower(); h = h.replace(k, v)
assert '__' not in ''.join(x for x in ['__WASM_B64__', '__APPJS__'] if x in h), 'unfilled placeholder'
open(P('index.html'), 'w', encoding='utf-8').write(h)
print('wrote index.html,', len(h) // 1024, 'KB')
