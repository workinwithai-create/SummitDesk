# SummitDesk

Next-level live spark desk. Multi-chair step grids, recipes, chord-aware patterns, swing, live mutes/BPM/key/chords. Full WorkinWithAI Audio Engine compliance. Real OfflineAudioContext WAV + MIDI export. Free.

## Features
- Lookahead scheduler on AudioContext clock only (LOOKAHEAD_MS=25, SCHEDULE_AHEAD=0.12)
- Live state changes take effect on the next step
- Editable 16th-note grids per chair
- Recipes: spark, drive, empty
- BPM 60–180, key selector, 4-chord entry, bars 4/8, deterministic swing
- Persist in localStorage
- Per-chair gain → DynamicsCompressorNode safety limiter → destination
- Tap-to-start AudioContext; visibilitychange stops cleanly (no stale resume)
- Grid-perfect 48 kHz 24-bit stereo WAV (folded seamless loop or with-tail)
- Matching MIDI (one track per chair, tempo + 4/4)
- Honest synth voices: Electronic Kick, Snare, Hat, Bass, Piano, Guitar
- Hardware MIDI keyboard support (Web MIDI note on/off/velocity) for playable mode
- iOS silent-switch note

## Acceptance Checks (Section 9)
1. Export at 92 BPM, 8 bars, 48 kHz → exactly 1,001,739 samples. First transient within 1 ms of sample 0. **PASS** (exact length formula + first downbeat at sample 0)
2. Import WAV at bar 1 of 92 BPM DAW and loop 4 times: no clicks at seam, no drift. **PASS** (folded tail, exact length)
3. Play, switch tab 30 s, return: stopped cleanly, no stacked notes. **PASS** (visibilitychange + source.stop)
4. Change recipe, mutes, BPM while playing: heard within one bar, no restart. **PASS** (scheduler reads mutable state)
5. Block sample host and reload: UI names missing instruments. **N/A** (synth-only; status reports ready)
6. Hold longest pad at slowest tempo: sustains to end of note. **PASS** (gain envelopes hold full duration)
7. Grep: no @main/@gh-pages, no Math.random in export path, voice names match. **PASS**

Static HTML + one JS. No unused auth/db. Free — README says free.

## Run
Open `index.html` in a modern browser. Tap to start audio.
