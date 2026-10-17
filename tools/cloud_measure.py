# Measure the thruster cloud in the static hover shot: area, extents, brightness over time.
import sys, glob
import numpy as np
from PIL import Image
files = sorted(glob.glob(sys.argv[1] + '/f_*.png'))
t0 = float(sys.argv[2]); fps = float(sys.argv[3])
# scale: car length in px measured on the first frame (car parked, brightest white blob)
def lum(a): return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
a0 = np.asarray(Image.open(files[0]).convert('RGB')).astype(np.float32)
L0 = lum(a0)
H, W = L0.shape
car = L0 > 120
ys, xs = np.nonzero(car[: int(H * 0.9)])
# restrict to the central region where the car is
sel = (xs > W * 0.3) & (xs < W * 0.7) & (ys > H * 0.3)
xs, ys = xs[sel], ys[sel]
car_px = xs.max() - xs.min()
m_per_px = 4.39 / car_px
ground_y = ys.max()
print(f'car length {car_px}px -> {m_per_px*100:.2f} cm/px, ground y={ground_y}')
print('   t(s)  area(m2)  width(m)  height(m)  meanLum  redness  coverage')
bg = np.median(np.stack([lum(np.asarray(Image.open(f).convert('RGB')).astype(np.float32)) for f in files[:5]]), axis=0)
for i, f in enumerate(files):
    a = np.asarray(Image.open(f).convert('RGB')).astype(np.float32)
    L = lum(a)
    diff = L - bg
    # cloud: brighter than background by a margin, below the sky band, not the tiny car
    m = (diff > 18) & (np.arange(H)[:, None] > H * 0.25)
    n = m.sum()
    if n < 50:
        print(f'{t0 + i / fps:7.1f}  {0:8.1f}'); continue
    ys, xs = np.nonzero(m)
    x0, x1 = np.percentile(xs, [2, 98]); y0 = np.percentile(ys, 2)
    area = n * m_per_px ** 2
    red = (a[..., 0][m].mean() + 1) / (a[..., 2][m].mean() + 1)
    print(f'{t0 + i / fps:7.1f}  {area:8.1f}  {(x1 - x0) * m_per_px:8.1f}  {(ground_y - y0) * m_per_px:9.1f}  {L[m].mean():7.1f}  {red:7.2f}  {n / (H*W) * 100:6.2f}%')
