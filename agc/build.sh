#!/bin/sh
# Build agc.wasm from this directory. Needs wasi-sdk 25 (https://github.com/WebAssembly/wasi-sdk);
# set WASI_SDK to its install path.
set -e
W=${WASI_SDK:-$HOME/wasi-sdk-25.0-x86_64-linux}; Y=./yaAGC
CF="--target=wasm32-wasi --sysroot=$W/share/wasi-sysroot -O2 -w -DWASI=yes -DNVER=\"x\" -I$Y"
for f in $Y/agc_engine.c $Y/agc_engine_init.c shim.c; do $W/bin/clang $CF -c $f -o $(basename $f .c).o; done
$W/bin/clang --target=wasm32-wasi --sysroot=$W/share/wasi-sysroot -O2 -mexec-model=reactor -Wl,--export-dynamic -Wl,--allow-undefined -o agc.wasm agc_engine.o agc_engine_init.o shim.o
