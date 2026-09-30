import numpy as np, wave
SR=48000; N=15*SR
def rd(p):
    w=wave.open(p); a=np.frombuffer(w.readframes(w.getnframes()),dtype='<i2').astype(np.float64)/32768
    return a.reshape(-1,2)
mus=rd('music.wav'); mus=np.pad(mus,((0,max(0,N-len(mus))),(0,0)))[:N]
rng=np.random.default_rng(1)
fx=np.zeros((N,2))
def lp(x,a):  # one-pole lowpass, a in (0,1)
    y=np.empty_like(x); s=0.0
    for i in range(len(x)): s+=a*(x[i]-s); y[i]=s
    return y
def put(sig,t,g,pan=0.0):
    i=int(t*SR); n=min(len(sig),N-i)
    if n<=0: return
    fx[i:i+n,0]+=sig[:n]*g*(1-pan)**.5; fx[i:i+n,1]+=sig[:n]*g*(1+pan)**.5
def whoosh(dur,rise=0.6):
    n=int(dur*SR); x=rng.standard_normal(n); tt=np.linspace(0,1,n)
    env=np.where(tt<rise,(tt/rise)**2,((1-tt)/(1-rise))**1.5)
    # sweep: blend of low and high filtered noise following env
    lo=lp(x,0.02); hi=x-lp(x,0.25)
    y=lo*3+hi*env*0.6
    return y*env/np.max(np.abs(y*env))
def sub(f0=62,dur=.6):
    n=int(dur*SR); tt=np.arange(n)/SR; f=f0*(1+1.2*np.exp(-tt*28))
    ph=2*np.pi*np.cumsum(f)/SR; return np.sin(ph)*np.exp(-tt*6)
def tick(f=1760,dur=.09):
    n=int(dur*SR); tt=np.arange(n)/SR
    return (np.sin(2*np.pi*f*tt)*0.6+np.sin(2*np.pi*f*1.5*tt)*0.25)*np.exp(-tt*55)
def click():
    n=int(.03*SR); tt=np.arange(n)/SR; x=rng.standard_normal(n)
    return (lp(x,.35)*np.exp(-tt*260)+np.sin(2*np.pi*900*tt)*np.exp(-tt*120)*.5)
# placements (seconds) matched to the picture
put(whoosh(.9,.75),0.05,.10,-.2)                 # posts drift in
put(sub(58,.8),1.98,.55); put(whoosh(.35,.85),1.72,.12)   # "Found."
put(whoosh(.55,.7),2.62,.16,.3)                  # posts stream into scan
for i in range(4): put(tick(1320*[1,1.122,1.26,1.5][i]),3.12+i*.5,.10,-.3+.2*i)  # sources check in
put(tick(1980,.14),4.5,.10); put(tick(2640,.16),5.0,.12)   # 37 / 12
put(whoosh(.9,.62),5.2,.18,-.1)                  # window rises
for i in range(3): put(whoosh(.35,.6),6.82+i*.25,.07,-.4+.4*i)  # cards lift
put(sub(70,.45),8.0,.28)                          # rack focus 91
put(whoosh(.55,.55),8.8,.22,.6)                   # whip
put(click(),10.5,.35); put(tick(2200,.12),10.53,.06)
put(whoosh(.7,.7),11.35,.16)                      # focus pull out
put(sub(52,1.2),12.05,.5)                         # outro
put(tick(1760,.3),13.0,.07); put(tick(2637,.3),13.02,.04)
# shared room: short exponential-noise reverb
ir_n=int(.9*SR); tt=np.arange(ir_n)/SR; ir=rng.standard_normal((ir_n,2))*np.exp(-tt*5.5)[:,None]; ir[:,0]=lp(ir[:,0],.3); ir[:,1]=lp(ir[:,1],.3); ir/=np.sqrt((ir**2).sum(0))
L=1<<int(np.ceil(np.log2(N+ir_n)))
wet=np.stack([np.fft.irfft(np.fft.rfft(fx[:,c],L)*np.fft.rfft(ir[:,c],L),L)[:N] for c in range(2)],1)
sfx=fx+wet*0.35
# music: gentle fade in/out, duck slightly under the big hits
g=np.ones(N); fi=int(.12*SR); g[:fi]=np.linspace(0,1,fi); fo=int(1.4*SR); g[-fo:]=np.linspace(1,0,fo)**1.5
mix=mus*0.82*g[:,None]+sfx*0.9
# soft limiter
mix=np.tanh(mix*1.1)/np.tanh(1.1)
pk=np.max(np.abs(mix)); mix=mix/pk*0.89
w=wave.open('mix.wav','wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix*32767).astype('<i2').tobytes()); w.close()
print('peak',pk)
