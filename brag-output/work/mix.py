import subprocess, numpy as np, imageio_ffmpeg
FF = imageio_ffmpeg.get_ffmpeg_exe(); SR = 48000; DUR = 24.0
A = "/home/user/wanterest/.claude/skills/brag/assets/"
def load(path, start=0, dur=None):
    cmd = [FF, "-v", "quiet", "-ss", str(start), "-i", path] + (["-t", str(dur)] if dur else []) + ["-ac", "2", "-ar", str(SR), "-f", "f32le", "-"]
    return np.frombuffer(subprocess.run(cmd, capture_output=True).stdout, dtype=np.float32).reshape(-1, 2).copy()
N = int(SR * DUR)
music = load(A + "music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3", 5.74, DUR)[:N]
music = np.pad(music, ((0, N - len(music)), (0, 0)))
t = np.arange(N) / SR
env = np.clip(t / 0.35, 0, 1) * np.clip((DUR - t) / 1.3, 0, 1)
env *= np.where(t < 3.0, 0.72, 1.0)          # hold the intro back, let the lift hit at 3.0
music *= env[:, None] * 0.9

bus = np.zeros((N, 2), np.float32)
rng = np.random.default_rng(3)
def put(sig, at, gain, pan=0.0):
    i = int(at * SR); s = sig[: max(0, N - i)]
    l, r = np.sqrt(0.5 * (1 - pan)), np.sqrt(0.5 * (1 + pan))
    bus[i:i + len(s), 0] += s[:, 0] * gain * l * 1.414; bus[i:i + len(s), 1] += s[:, 1] * gain * r * 1.414
def sfx(name, at, gain, pan=0.0): put(load(A + "sfx/" + name), at, gain, pan)
def lp(x, fc):  # one-pole lowpass, time-varying cutoff allowed
    fc = np.broadcast_to(fc, x.shape[:1]); a = np.exp(-2 * np.pi * fc / SR); y = np.zeros_like(x); p = np.zeros(x.shape[1])
    for i in range(len(x)): p = (1 - a[i]) * x[i] + a[i] * p; y[i] = p
    return y
def whoosh(dur, f0, f1, shape="swell"):
    n = int(dur * SR); x = rng.standard_normal((n, 2)).astype(np.float32); u = np.linspace(0, 1, n)
    fc = f0 * (f1 / f0) ** u
    y = lp(lp(x, fc), fc) - lp(lp(x, fc * 0.25), fc * 0.25)   # band-ish
    e = np.sin(np.pi * u) ** 2 if shape == "swell" else (u ** 2.5) * (1 - np.clip((u - 0.92) / 0.08, 0, 1))
    y *= e[:, None]; return y / (np.abs(y).max() + 1e-9)

put(whoosh(0.95, 300, 2400), 0.9, 0.22, -0.6)        # scan sweep
sfx("ui/rollover2.ogg", 2.08, 0.25)                    # highlight marker
put(whoosh(1.15, 150, 3500, "riser"), 1.87, 0.26)     # riser into the lift
sfx("interface/bong_001.ogg", 2.84, 0.3)              # the dot
sfx("impact/impactSoft_heavy_003.ogg", 3.0, 0.7)      # cream burst on the lift
put(whoosh(0.8, 2400, 300), 3.8, 0.2)                 # push through "Meet"
put(whoosh(0.5, 300, 1500), 3.95, 0.12)              # logo draw
put(whoosh(0.9, 200, 1600), 6.0, 0.24)                # window flies in
for i in range(4): sfx("interface/click_003.ogg", 6.6 + i * 0.12, 0.16, -0.2 + i * 0.12)
for a in (6.75, 7.35, 8.45, 11.0, 11.9, 15.5, 17.25, 18.5): sfx("impact/impactSoft_medium_000.ogg", a, 0.28, -0.5)  # word stack taps
sfx("ui/click2.ogg", 8.2, 0.45, 0.2)                   # click r/SaaS
put(whoosh(0.45, 400, 1800), 8.3, 0.12, 0.5)          # detail panel
put(whoosh(1.1, 120, 900), 8.35, 0.2)                 # camera push
sfx("ui/rollover2.ogg", 9.2, 0.2)                      # 'simpler'
put(whoosh(0.4, 500, 5000), 10.3, 0.42, -0.4)         # whip
sfx("impact/impactSoft_medium_001.ogg", 10.62, 0.45)
put(whoosh(0.45, 1800, 300), 13.55, 0.2)              # board recedes
sfx("impact/impactSoft_medium_004.ogg", 13.9, 0.4)    # action card lands
for k in np.arange(14.35, 15.0, 0.05):                 # typing the suggestion
    sfx(f"keyboard/keypress-{rng.integers(1, 33):03d}.wav", k + rng.uniform(-0.01, 0.01), 0.09 + rng.uniform(0, 0.04), rng.uniform(-0.2, 0.2))
sfx("ui/click2.ogg", 15.28, 0.5, 0.35)                 # Accept
sfx("interface/bong_001.ogg", 15.35, 0.34, 0.35)
put(whoosh(0.7, 1600, 250), 15.55, 0.18)              # card recedes
put(whoosh(0.8, 200, 1800), 15.75, 0.2, 0.5)          # homepage arrives
put(whoosh(0.85, 350, 2600), 16.1, 0.24, -0.3)        # line flies into the hero
sfx("impact/impactSoft_medium_003.ogg", 16.95, 0.45)  # lands
sfx("interface/bong_001.ogg", 17.35, 0.3, 0.5)        # live
put(whoosh(0.8, 200, 1800), 17.95, 0.2, 0.5)          # experiment arrives
put(whoosh(0.9, 200, 1400, "riser"), 18.35, 0.12)     # chart draws
sfx("interface/bong_001.ogg", 19.25, 0.34, 0.4)       # met threshold
sfx("ui/rollover2.ogg", 19.3, 0.2, 0.4)
put(whoosh(0.6, 250, 2600, "riser"), 20.7, 0.3)       # ink closes
sfx("impact/impactSoft_heavy_000.ogg", 21.25, 0.6)
sfx("impact/impactSoft_heavy_004.ogg", 22.0, 0.6)     # Find it.
put(whoosh(0.5, 400, 2200), 22.45, 0.1)               # underline

# Shared space: short stereo room reverb on the SFX bus, gentle top-end roll-off
ir_n = int(0.9 * SR); ir = rng.standard_normal((ir_n, 2)) * np.exp(-np.arange(ir_n) / SR * 7)[:, None]; ir[:int(0.012*SR)] = 0
ir /= np.sqrt((ir ** 2).sum(0))
wet = np.stack([np.convolve(bus[:, c], ir[:, c])[:N] for c in range(2)], 1)
sfxmix = lp(bus * 0.85 + wet * 0.28, 9000.0)
# light ducking of music under the big hits
duck = np.ones(N)
for h in (3.0, 10.62, 21.25, 22.0):
    duck -= 0.22 * np.exp(-np.clip(t - h, 0, None) / 0.18) * (t >= h - 0.02)
mix = music * duck[:, None] + sfxmix
peak = np.abs(mix).max(); mix = np.tanh(mix / peak * 1.25) / np.tanh(1.25) * 0.89  # soft-clip to ~-1 dBFS
subprocess.run([FF, "-y", "-v", "quiet", "-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", "-", "-c:a", "pcm_s16le", "mix.wav"], input=mix.astype(np.float32).tobytes())
print("ok", round(20 * np.log10(np.sqrt((mix ** 2).mean())), 1), "dBFS rms")
