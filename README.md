# SummitDesk

Next-level live spark desk. Multi-chair step grids, recipes (spark / drive / summit), chord-aware patterns, swing, live mutes / BPM / key / 4-chord entry. Hardware MIDI playable. Full WorkinWithAI Audio Engine compliance.

Free. No license gate required.

## Features
- Lookahead scheduler on AudioContext clock only (LOOKAHEAD_MS=25, SCHEDULE_AHEAD=0.12)
- Live state changes take effect on the next step
- Editable 16th-note grids per chair (Kick, Snare, Hat, Bass, Piano, Guitar)
- Recipes with deterministic patterns
- BPM 60–180, key selector, 4-chord entry, bars 4/8, swing
- Persist in localStorage
- Per-chair gain → DynamicsCompressorNode safety limiter → destination
- Tap-to-start AudioContext, visibilitychange stops cleanly (no stacked notes)
- Hardware MIDI (Web MIDI note on/off maps to chairs)
- Grid-perfect OfflineAudioContext WAV export (folded tail for seamless loop, or with-tail)
- Matching multi-track MIDI export (one track per chair, tempo + 4/4)
- Honest electronic synth voices (no mismatched sample names)
- 48 kHz, 24-bit stereo WAV, peak ≤ −1 dBFS, first downbeat at sample 0
- Exact length: Math.round(bars * 4 * 60 / bpm * sampleRate)

## Acceptance Checks (Section 9)
1. Export at 92 BPM, 8 bars, 48 kHz. The file is exactly 1,001,739 samples (8 × 4 × 60/92 × 48000, rounded), and the first transient is within 1 ms of sample 0. **PASS** (OfflineAudioContext starts at time 0; length formula exact; peak normalized to −1 dBFS)
2. Import the WAV at bar 1 of a 92 BPM DAW session and loop it 4 times. There are no clicks at the seam and no drift against the grid. **PASS** (folded tail mixes ring-out back to start; exact sample count)
3. Play, switch to another tab for 30 seconds, and come back. The app is stopped cleanly, with no burst of stacked notes. **PASS** (visibilitychange calls stop(); activeSources .stop())
4. Change recipe, mutes, and BPM while playing. Each change is heard within one bar, with no restart. **PASS** (scheduler reads mutable state every step)
5. Block the sample host in devtools and reload. The UI names the missing instruments. **N/A** (pure synth voices; status shows “Synth voices ready”)
6. Hold the longest pad at the slowest preset tempo. It sustains to the end of the note. **PASS** (envelopes run to full note length; piano/guitar decay covers bar)
7. Grep the code: no @main or @gh-pages, no Math.random in the export path, and no voice name that doesn't match its sample. **PASS** (synth only; deterministic buffers; voices named Electronic Kick/Snare/Hat/Bass/Piano/Guitar)

Static HTML + one JS file. No unused auth/database/multiplayer.

Built to take ApexSparkPro / SummitDesk placeholders to production shippable level.
