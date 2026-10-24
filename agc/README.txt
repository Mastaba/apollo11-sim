Corresponding source for agc.wasm, the Apollo Guidance Computer emulator embedded in the
Apollo 11 simulator page.

yaAGC/      Virtual AGC's yaAGC CPU engine, unmodified, from
            https://github.com/virtualagc/virtualagc  commit 5291dbe493db71bdba258198e7ff33910fee6e1b
            Copyright 2003-2019 Ronald S. Burkey and contributors. GPL v2 or later (see COPYING).
shim.c      Browser I/O layer that replaces yaAGC's socket API (GPL v2 or later).
agc.js      JavaScript wrapper and DSKY decoder (GPL v2 or later).
build.sh    Build script: compiles the three C files with wasi-sdk 25 to a WebAssembly reactor (agc.wasm).

The core-rope images (Comanche 055, Luminary 099) are assembled with Virtual AGC's yaYUL from the
public-domain AGC source code (github.com/chrislgarry/Apollo-11, github.com/virtualagc/virtualagc).

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
