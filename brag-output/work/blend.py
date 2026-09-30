import numpy as np, os
from PIL import Image
from multiprocessing import Pool
os.makedirs("frames", exist_ok=True)
def go(i):
    acc = sum(np.asarray(Image.open(f"sub/f{i:04d}_{k}.jpg"), dtype=np.float32) for k in range(6)) / 6
    Image.fromarray(np.clip(acc + 0.5, 0, 255).astype(np.uint8)).save(f"frames/f{i:04d}.jpg", quality=95)
with Pool(8) as p: p.map(go, range(720))
