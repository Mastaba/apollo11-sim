// SPDX-License-Identifier: GPL-2.0-or-later
// Part of the Apollo 11 simulator. Free software under the GNU GPL v2 or later; see the Licences section of the page.
// Browser shim around Virtual AGC's yaAGC engine (agc_engine.c, GPL v2).
// Replaces the socket-based peripheral API with a simple memory-mapped one
// that JavaScript drives directly.
#include <stdint.h>
#include <string.h>
#include <stdlib.h>
#include "yaAGC.h"
#include "agc_engine.h"

#define EXPORT __attribute__((visibility("default")))

// Output-channel event FIFO read by JS: (channel<<16)|value.
#define QN 4096
static uint32_t OutQ[QN];
static int QHead = 0, QTail = 0;
static int16_t LastOut[NUM_CHANNELS];

void ChannelOutput(agc_t *State, int Channel, int Value) {
  // Channel 7 (superbank select) is internal to the CPU, as in SocketAPI.c.
  if (Channel == 7) { State->InputChannel[7] = State->OutputChannel7 = (Value & 0160); return; }
  // LM rotational hand controller counters, as in SocketAPI.c.
  if (Channel == 013 && 0600 == (0600 & Value) && !CmOrLm) {
    State->Erasable[0][042] = LastRhcPitch; State->Erasable[0][043] = LastRhcYaw; State->Erasable[0][044] = LastRhcRoll;
  }
  if (Channel >= 0 && Channel < NUM_CHANNELS) LastOut[Channel] = Value;
  int n = (QHead + 1) % QN;
  if (n != QTail) { OutQ[QHead] = ((uint32_t)(Channel & 0xFFFF) << 16) | (Value & 0xFFFF); QHead = n; }
}
int ChannelInput(agc_t *State) { return 0; }
void ChannelRoutine(agc_t *State) {}
void ShiftToDeda(agc_t *State, int Data) {}
void RequestRadarData(agc_t *State) {}
void BacktraceAdd(agc_t *State, int Cause) {}
FILE *rfopen(const char *Filename, const char *mode) { return NULL; }
void DecodeDigitalDownlink(int Channel, int Value, int CmOrLm) {}

EXPORT int agc_out_pop(void) {
  if (QHead == QTail) return -1;
  uint32_t v = OutQ[QTail]; QTail = (QTail + 1) % QN; return (int)v;
}
EXPORT int agc_last_out(int ch) { return LastOut[ch & 0777]; }

EXPORT agc_t *agc_new(void) {
  agc_t *s = (agc_t *)calloc(1, sizeof(agc_t));
  agc_engine_init(s, NULL, NULL, 0);
  return s;
}
EXPORT uint8_t *agc_alloc(int n) { return (uint8_t *)malloc(n); }

// Same bank ordering as agc_load_binfile(): 2,3,0,1,4,5,...,35
EXPORT int agc_load_rom(agc_t *State, const uint8_t *buf, int nbytes) {
  int n = nbytes / 2, Bank = 2, j = 0, i;
  State->CheckParity = 0;
  memset(&State->Parities, 0, sizeof(State->Parities));
  for (i = 0; i < n; i++) {
    uint16_t RawValue = buf[2 * i] * 256 + buf[2 * i + 1];
    uint8_t Parity = RawValue & 1;
    State->Fixed[Bank][j] = RawValue >> 1;
    State->Parities[(Bank * 02000 + j) / 32] |= Parity << (j % 32);
    if (Parity) State->CheckParity = 1;
    if (++j == 02000) {
      j = 0;
      if (Bank == 2) Bank = 3; else if (Bank == 3) Bank = 0;
      else if (Bank == 0) Bank = 1; else if (Bank == 1) Bank = 4; else Bank++;
      if (Bank > 35) break;
    }
  }
  return 0;
}

EXPORT void agc_set_cm(int cm) { CmOrLm = cm; }

// Run n machine cycles (11.7 us each).
EXPORT void agc_run(agc_t *State, int n) { while (n-- > 0) agc_engine(State); }

// DSKY keystroke: 5-bit keycode on channel 015 and KEYRUPT1.
EXPORT void agc_key(agc_t *State, int code) {
  WriteIO(State, 015, code & 037);
  State->InterruptRequests[5] = 1;
}
// PRO key is channel 032 bit 14, active low.
EXPORT void agc_pro(agc_t *State, int pressed) {
  int v = ReadIO(State, 032);
  if (pressed) v &= ~020000; else v |= 020000;
  WriteIO(State, 032, v);
}
EXPORT int agc_read_io(agc_t *State, int ch) { return ReadIO(State, ch); }
EXPORT void agc_write_io(agc_t *State, int ch, int v) { WriteIO(State, ch, v); }
EXPORT void agc_incr(agc_t *State, int counter, int type) { UnprogrammedIncrement(State, counter, type); }
EXPORT int agc_erasable(agc_t *State, int bank, int off) { return State->Erasable[bank & 7][off & 0377]; }
EXPORT void agc_set_erasable(agc_t *State, int bank, int off, int v) { State->Erasable[bank & 7][off & 0377] = v; }
EXPORT int agc_fixed(agc_t *State, int bank, int off) { return State->Fixed[bank][off & 01777]; }
EXPORT double agc_cycles(agc_t *State) { return (double)State->CycleCounter; }
EXPORT int agc_out10(agc_t *State, int row) { return State->OutputChannel10[row & 15]; }
EXPORT int agc_ch163(agc_t *State) { return State->DskyChannel163; }
