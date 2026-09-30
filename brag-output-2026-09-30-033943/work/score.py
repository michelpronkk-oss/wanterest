# Original score for the Wanterest film: 120 BPM, F minor, arranged to the picture.
import numpy as np, wave
from scipy.signal import butter, sosfilt, lfilter, fftconvolve
SR=48000; DUR=23.0; N=int(DUR*SR); rng=np.random.default_rng(11)
T=np.arange(N)/SR
def hz(m): return 440*2**((m-69)/12)
def buf(): return np.zeros((N,2))
def add(b,sig,t,g=1.0,pan=0.0):
    i=int(round(t*SR)); 
    if i>=N: return
    if sig.ndim==1: sig=np.stack([sig*np.sqrt((1-pan)/2)*1.414,sig*np.sqrt((1+pan)/2)*1.414],1)
    n=min(len(sig),N-i); b[i:i+n]+=sig[:n]*g
def bp(x,lo,hi,o=2): return sosfilt(butter(o,[lo,hi],'bandpass',fs=SR,output='sos'),x,axis=0)
def hp(x,f,o=2): return sosfilt(butter(o,f,'highpass',fs=SR,output='sos'),x,axis=0)
def lpf(x,f,o=2): return sosfilt(butter(o,f,'lowpass',fs=SR,output='sos'),x,axis=0)
def tvlp(x,cut,chunk=480):  # time-varying 2-pole lowpass (cascaded one-poles), cut: array per sample
    y=np.empty_like(x); z1=np.zeros(x.shape[1]); z2=np.zeros(x.shape[1])
    for s in range(0,len(x),chunk):
        c=cut[min(s,len(cut)-1)]; a=1-np.exp(-2*np.pi*c/SR)
        seg=x[s:s+chunk]
        for ch in range(x.shape[1]):
            o1,zf1=lfilter([a],[1,-(1-a)],seg[:,ch],zi=[z1[ch]*(1-a)]); z1[ch]=o1[-1]
            o2,zf2=lfilter([a],[1,-(1-a)],o1,zi=[z2[ch]*(1-a)]); z2[ch]=o2[-1]
            y[s:s+len(seg),ch]=o2
    return y
def env_ar(n,a,r): 
    t=np.arange(n)/SR; return np.minimum(1,t/max(a,1e-4))*np.exp(-t/r)
def ramp(points):  # piecewise-linear automation over the timeline
    xs=[p[0] for p in points]; ys=[p[1] for p in points]; return np.interp(T,xs,ys)

BEAT=.5
CH={'Fm9':[53,56,60,63,67],'Db9':[49,53,56,60,63],'Ab7':[56,60,63,67],'Eb6':[51,55,58,60]}
ROOT={'Fm9':29,'Db9':37,'Ab7':32,'Eb6':39}
BARS=['Fm9','Db9','Ab7','Eb6','Fm9','Db9','Ab7','Eb6','Fm9','Db9','Db9','Db9']
def chord_at(t): return BARS[min(int(t//2),len(BARS)-1)]
def inr(t,rs): return any(a<=t<b for a,b in rs)
KICK=[(2.0,11.5),(12.0,14.5),(16.5,19.75)]

# ---------- instruments ----------
def kick():
    n=int(.45*SR); t=np.arange(n)/SR; f=48+100*np.exp(-t*32); ph=2*np.pi*np.cumsum(f)/SR
    k=np.sin(ph)*np.exp(-t*7.5); k+=bp(rng.standard_normal(n),1500,5000)*np.exp(-t*260)*.25
    return np.tanh(k*1.6)
def clap():
    n=int(.35*SR); t=np.arange(n)/SR; x=rng.standard_normal(n); e=np.zeros(n)
    for d in (0,.009,.019): e+=np.where(t>=d,np.exp(-(t-d)*(160 if d<.019 else 16)),0)
    return bp(x,900,3200)*e*.8
def hat(dec,g=1): n=int(dec*6*SR); t=np.arange(n)/SR; return hp(rng.standard_normal(n),7500)*np.exp(-t/dec)*g
def tick(m,dec=.06): n=int(dec*8*SR); t=np.arange(n)/SR; return (np.sin(2*np.pi*hz(m)*t)+.3*np.sin(2*np.pi*hz(m)*2.01*t))*np.exp(-t/dec)
def pluck(m,dur=.5,bright=1.0):
    n=int(dur*SR); t=np.arange(n)/SR; f=hz(m); y=np.zeros(n)
    for k in range(1,14):
        if f*k>12000: break
        y+=np.sin(2*np.pi*f*k*t+rng.random()*6.28)/k*np.exp(-t*(4+k*k*.9/bright))
    return y*np.minimum(1,t/.003)
def pad_note(m,dur,rel=1.2):
    n=int((dur+rel)*SR); t=np.arange(n)/SR; y=np.zeros((n,2))
    for v,(det,pan) in enumerate([(-7,-.6),(0,0),(7,.6)]):
        f=hz(m)*2**(det/1200); s=np.zeros(n); ph=rng.random()*6.28
        for k in range(1,12):
            if f*k>9000: break
            s+=np.sin(2*np.pi*f*k*t+ph*k)/k
        y[:,0]+=s*(1-pan)*.5; y[:,1]+=s*(1+pan)*.5
    e=np.minimum(1,t/.35)*np.where(t<dur,1,np.exp(-(t-dur)/(rel/3)))
    return y*e[:,None]
def bass(m,dur=.2):
    n=int((dur+.05)*SR); t=np.arange(n)/SR; f=hz(m)
    s=np.sin(2*np.pi*f*t)+.35*np.sin(2*np.pi*2*f*t)
    e=np.minimum(1,t/.005)*np.where(t<dur,1,np.exp(-(t-dur)/.015))
    return np.tanh(s*1.8)*e
def noise_riser(dur,f0=400,f1=6000):
    n=int(dur*SR); x=rng.standard_normal((n,2)); cut=np.geomspace(f0,f1,n)
    y=tvlp(x,cut); e=(np.arange(n)/n)**2.2; return y*e[:,None]
def swell(dur,m_list):  # reversed reverb'd chord = reverse swell
    s=sum(pluck(m,dur,2.0) for m in m_list); ir=rng.standard_normal(int(1.6*SR))*np.exp(-np.arange(int(1.6*SR))/SR*3)
    w=fftconvolve(s,ir)[:int(dur*SR)]; w=w[::-1]; w/=np.max(np.abs(w)); return w*np.linspace(0,1,len(w))**1.5

drums=buf(); bassb=buf(); pad=buf(); arp=buf(); fx=buf(); ui=buf(); send=buf()
K=kick(); CL=clap()

# ---------- drums ----------
kick_env=np.zeros(N)
for i in range(int(DUR/BEAT)+1):
    t=i*BEAT
    if inr(t,KICK) or abs(t-20.0)<1e-6:
        add(drums,K,t,.95); j=int(t*SR); m=min(N,j+int(.28*SR)); kick_env[j:m]=np.maximum(kick_env[j:m],np.exp(-np.arange(m-j)/SR*9))
    if inr(t,[(2.5,11.5),(12.0,14.5),(16.5,19.75)]) and (t%2 in (0.5,1.5)):
        c=CL*.55; add(drums,c,t,1,.1); add(send,c,t,.5)
for i in range(int(DUR/.125)):
    t=i*.125
    if t>=19.75: break
    off=abs((t%0.5)-0.25)<1e-6
    if off and inr(t,[(2.0,14.5),(16.5,19.75)]): add(drums,hat(.045,.32),t,1,.35)
    elif inr(t,[(0.0,2.0),(2.0,14.5),(16.5,19.75)]): add(drums,hat(.018,.12*(1.25 if i%4==2 else 1)),t,1,-.3)
    if inr(t,[(14.5,16.5)]) and i%2==0: add(drums,tick(96,.012)*.10,t,1,.2); add(send,tick(96,.012)*.05,t)
# crash-like air on the drop and the outro (lowpassed so it never gets harsh)
air=lpf(hp(rng.standard_normal((int(2.2*SR),2)),3000),9000)*np.exp(-np.arange(int(2.2*SR))/SR*2.2)[:,None]
add(fx,air*.10,2.0); add(fx,air*.08,12.0); add(fx,air*.09,20.0)

# ---------- bass ----------
for i in range(int(DUR/BEAT)):
    t=i*BEAT+.25
    if inr(t,KICK): add(bassb,bass(ROOT[chord_at(t)],.19),t,.55)
for t0,t1,m in [(14.5,16.0,39),(16.0,16.5,29)]:
    n=int((t1-t0)*SR); tt=np.arange(n)/SR; s=np.sin(2*np.pi*hz(m)*tt)*np.minimum(1,tt/.2)*np.minimum(1,(t1-t0-tt)/.05)
    add(bassb,s,t0,.35)
add(bassb,bass(37,2.2),20.0,.6)   # final Db
# sub drop on "Found."
n=int(1.0*SR); tt=np.arange(n)/SR; add(bassb,np.sin(2*np.pi*np.cumsum(55*(1+np.exp(-tt*5)))/SR)*np.exp(-tt*3),2.0,.5)

# ---------- pad ----------
for b,name in enumerate(BARS):
    t=b*2.0
    if t>=22: break
    dur=2.0 if b<10 else 3.0
    for m in CH[name]: add(pad,pad_note(m,dur),t,.045)
    if b>=10: break
cut=ramp([(0,260),(1.9,1600),(2.0,2200),(11.3,2400),(11.9,420),(12.05,2600),(14.4,2600),(14.55,900),(16.45,2800),(18,2800),(19.7,1500),(20,2600),(23,700)])
pad=tvlp(pad,cut)

# ---------- arp ----------
PAT=[0,2,1,3,2,4,3,1]
def arp_on(t): return inr(t,[(6.0,11.5),(12.0,14.5),(15.5,16.5),(16.5,19.75)])
for i in range(int(DUR/.125)):
    t=i*.125
    if not arp_on(t): continue
    ch=CH[chord_at(t)]; m=ch[PAT[i%8]%len(ch)]+12
    vel=(1.0 if i%4==0 else .62)*(0.55 if 15.5<=t<16.5 else 1.0)
    br=1.6 if 12.0<=t<14.5 else 1.0
    add(arp,pluck(m,.45,br)*vel,t,.085,[-.35,.35][i%2])
# ping-pong delay (dotted eighth)
d=int(.375*SR); dl=np.zeros_like(arp); fb=.34
for k in range(1,5):
    s=arp*(fb**k); s=lpf(s,5000-800*k)
    if k%2: s=s[:,::-1]
    dl[k*d:]+=s[:-k*d]
arp=arp+dl*.8
add(send,arp*.3,0)

# ---------- stabs & moments ----------
def stab(chord,t,g=.12):
    s=sum(pluck(m+12,1.2,2.2) for m in CH[chord]); add(fx,s,t,g); add(send,s,t,g*.8)
stab('Fm9',2.0,.13)                       # "Found."
stab('Db9',18.0); stab('Eb6',18.5); stab('Fm9',19.0,.14)   # Demand / Action / Measured growth
fin=sum(pluck(m+12,3.0,2.6) for m in CH['Db9']+[72])
add(fx,fin,20.0,.14); add(send,fin,20.0,.16)
# +34% lift: soft bell (F6 + C7)
bell=pluck(89,2.0,3.0)+.6*pluck(96,2.0,3.0); add(fx,bell,16.5,.07,.2); add(send,bell,16.5,.08)
# chart line: gentle rising tone under the Wanterest Action line (15.55 -> 16.5)
n=int(.95*SR); tt=np.arange(n)/SR; f=hz(72)*2**(tt/.95*(5/12))
line=np.sin(2*np.pi*np.cumsum(f)/SR)*np.sin(np.pi*tt/.95)**2*.5; add(fx,line,15.55,.035,.25); add(send,line,15.55,.03)

# risers / swells / whooshes
add(fx,noise_riser(1.5,300,5000),0.5,.05)
add(fx,swell(1.5,CH['Fm9']),0.5,.06)
add(fx,swell(.9,CH['Fm9']),11.1,.08)
add(fx,noise_riser(.7,500,7000),11.3,.045)
add(fx,noise_riser(.45,800,8000),14.05,.05)
add(fx,noise_riser(.6,400,5000),17.4,.04)
add(fx,swell(.6,CH['Db9']),19.4,.07)
def whoosh(dur):
    n=int(dur*SR); x=rng.standard_normal((n,2)); tt=np.linspace(0,1,n); e=np.sin(np.pi*tt)**2
    return bp(x,250,3500)*e[:,None]
for t,g in [(2.7,.05),(5.35,.05),(8.9,.06),(14.35,.05),(17.75,.04)]: add(fx,whoosh(.55),t,g)

# ---------- UI details (in key) ----------
for i,m in enumerate([84,87,89,91]): add(ui,tick(m),3.0+i*.5,.05,-.3+.2*i)
add(ui,tick(94),4.5,.05); add(ui,tick(96),5.0,.06)
def mclick():
    n=int(.04*SR); t=np.arange(n)/SR; return bp(rng.standard_normal(n),1500,6000)*np.exp(-t*300)+np.sin(2*np.pi*700*t)*np.exp(-t*140)*.4
add(ui,mclick(),10.5,.18); add(ui,mclick(),14.0,.18); add(ui,tick(89,.1),14.02,.04)
add(send,ui,0,.6)

# ---------- mix ----------
duck=1-.6*kick_env
bassb*=duck[:,None]; pad*=(1-.45*kick_env)[:,None]; arp*=(1-.35*kick_env)[:,None]
irn=int(2.4*SR); tt=np.arange(irn)/SR
ir=rng.standard_normal((irn,2))*np.exp(-tt*2.6)[:,None]; ir=lpf(ir,6000); ir[:int(.012*SR)]=0; ir/=np.sqrt((ir**2).sum(0))
send=hp(send,250)
wet=np.stack([fftconvolve(send[:,c],ir[:,c])[:N] for c in range(2)],1)
mix=drums*.95+bassb*.78+pad*1.3+arp*1.45+fx*1.0+ui*1.0+wet*.35
# master fade-out tail and gentle glue
g=np.ones(N); fo=int(1.6*SR); g[-fo:]=np.linspace(1,0,fo)**2; mix*=g[:,None]
mix=hp(mix,28); mix=np.tanh(mix*1.3)/1.3
mix/=np.max(np.abs(mix))*1.12
w=wave.open('score.wav','wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(mix,-1,1)*32767).astype('<i2').tobytes()); w.close()
print('ok')
