# Core-rope images

`Comanche055.bin` (Command Module, Columbia) and `Luminary099.bin` (Lunar Module, Eagle) are the flight
software images the in-page emulator runs, assembled with Virtual AGC's `yaYUL` assembler. Both are
word-for-word identical to the ropes flown on Apollo 11.

The AGC source code is in the public domain.

- **Luminary 099** was assembled from [chrislgarry/Apollo-11](https://github.com/chrislgarry/Apollo-11)
  (commit 911e5c0) with `luminary099-yayul.patch` applied. The patch fixes two include file names in `MAIN.agc`
  and the label column on two lines, so that yaYUL accepts the transcription; it changes no code.
- **Comanche 055** comes from [Virtual AGC](https://github.com/virtualagc/virtualagc) (commit 5291dbe). Its
  transcription has been checked against the rope dump. The chrislgarry copy still differs in about 86 places.

To rebuild (needs a C compiler):

```sh
git clone https://github.com/virtualagc/virtualagc && git clone https://github.com/chrislgarry/Apollo-11
(cd virtualagc/yaYUL && gcc -O2 -DNVER='"x"' -o yaYUL *.c -lm)
(cd Apollo-11 && patch -p1 < ../ropes/luminary099-yayul.patch && cd Luminary099 && ../../virtualagc/yaYUL/yaYUL MAIN.agc > /dev/null)
(cd virtualagc/Comanche055 && ../yaYUL/yaYUL MAIN.agc > /dev/null)
# outputs: Apollo-11/Luminary099/MAIN.agc.bin and virtualagc/Comanche055/MAIN.agc.bin
```
