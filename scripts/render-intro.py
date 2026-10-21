"""Render the kiosk screensaver intro video (dist/assets/intro/intro.mp4).

Uses the club crest and roster photos synced into dist/assets (full-size originals are cached in
scripts/.intro-cache from the photoSource URLs in dist/club-content.js). Requires Pillow, numpy and ffmpeg on PATH.  Usage: python scripts/render-intro.py [--portrait] [--preview t1 t2 ...]
"""
import json, math, random, subprocess, sys, urllib.request
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
OUT = DIST / 'assets' / 'intro'
PORTRAIT = '--portrait' in sys.argv  # 1080x1920 for vertical kiosk panels
W, H = (1080, 1920) if PORTRAIT else (1920, 1080)
FPS, DURATION = 30, 24.0
NAME = 'intro-portrait' if PORTRAIT else 'intro'
LS = 600 if PORTRAIT else 520  # logo size
LOGO_CY = 720 if PORTRAIT else 400
TOUCH_Y = 1640 if PORTRAIT else 920
FONT = 'C:/Windows/Fonts/bahnschrift.ttf' if Path('C:/Windows/Fonts/bahnschrift.ttf').exists() else 'DejaVuSans-Bold.ttf'

# FC Baník: royal navy, crest blue, sky blue and the crest red.
NAVY = np.array([8, 28, 66]) / 255
BLUE = np.array([31, 100, 166]) / 255
LIGHT = np.array([79, 179, 234]) / 255
RED = np.array([215, 25, 32]) / 255
WHITE = np.ones(3)

HEROES = [  # (photo id, first name, surname, number, position)
    ('471', 'Václav', 'JUREČKA', '15', 'ÚTOČNÍK'),
    ('475', 'Martin', 'JEDLIČKA', '23', 'BRANKÁŘ'),
    ('380', 'Filip', 'KUBALA', '28', 'ÚTOČNÍK'),
    ('48', 'Michal', 'FRYDRYCH', '17', 'OBRÁNCE'),
]
LINEUP = ['327', '407', '471', '475', '380']  # the middle one stands in front, larger
HERO_START, HERO_LEN = 2.6, 2.5
LINEUP_START = HERO_START + HERO_LEN * len(HEROES)  # 12.6
LOGO_START = 16.4
CUTS = [HERO_START + i * HERO_LEN for i in range(len(HEROES))] + [LINEUP_START]

rng = random.Random(7)

# ---------- helpers ----------
def clamp(x, a=0.0, b=1.0): return max(a, min(b, x))
def prog(t, a, b): return clamp((t - a) / (b - a))
def out_expo(x): return 1 if x >= 1 else 1 - 2 ** (-10 * x)
def out_cubic(x): return 1 - (1 - x) ** 3
def in_out(x): return 3 * x * x - 2 * x * x * x
def out_back(x, s=1.7): x -= 1; return 1 + x * x * ((s + 1) * x + s)

def font(size, style='Bold Condensed'):
    f = ImageFont.truetype(FONT, size)
    try: f.set_variation_by_name(style)
    except Exception: pass
    return f

def to_sprite(img):
    """PIL RGBA -> premultiplied float32 (h, w, 4)."""
    a = np.asarray(img.convert('RGBA'), dtype=np.float32) / 255
    a[..., :3] *= a[..., 3:4]
    return a

def blit(dst, spr, x, y, op=1.0):
    x, y = int(round(x)), int(round(y))
    h, w = spr.shape[:2]
    x0, y0, x1, y1 = max(x, 0), max(y, 0), min(x + w, W), min(y + h, H)
    if x0 >= x1 or y0 >= y1 or op <= 0: return
    s = spr[y0 - y:y1 - y, x0 - x:x1 - x]
    d = dst[y0:y1, x0:x1]
    d *= 1 - s[..., 3:4] * op
    d += s[..., :3] * op

def add(dst, spr, x, y, op=1.0):
    x, y = int(round(x)), int(round(y))
    h, w = spr.shape[:2]
    x0, y0, x1, y1 = max(x, 0), max(y, 0), min(x + w, W), min(y + h, H)
    if x0 >= x1 or y0 >= y1 or op <= 0: return
    dst[y0:y1, x0:x1] += spr[y0 - y:y1 - y, x0 - x:x1 - x, :3] * op

def text_sprite(text, size, color=(255, 255, 255), style='Bold Condensed', spacing=0, outline=0):
    f = font(size, style)
    chars = list(text)
    widths = [f.getlength(c) for c in chars]
    tw = int(sum(widths) + spacing * max(len(chars) - 1, 0)) + outline * 2 + 8
    asc, desc = f.getmetrics()
    top = outline + 4 + int(size * 0.35)  # room for accents above capitals (Á, Í, Ý, Ě), which rise above the ascent
    img = Image.new('L', (tw, asc + desc + top + outline + 4), 0)
    d = ImageDraw.Draw(img)
    x = outline + 4
    for c, cw in zip(chars, widths):
        d.text((x, top), c, font=f, fill=255, stroke_width=outline, stroke_fill=255)
        x += cw + spacing
    if outline:  # keep only the stroke ring
        inner = Image.new('L', img.size, 0)
        di = ImageDraw.Draw(inner); x = outline + 4
        for c, cw in zip(chars, widths):
            di.text((x, top), c, font=f, fill=255); x += cw + spacing
        img = Image.fromarray(np.clip(np.asarray(img, np.int16) - np.asarray(inner, np.int16), 0, 255).astype(np.uint8))
    img = img.crop(img.getbbox())
    rgba = Image.new('RGBA', img.size, color + (255,)); rgba.putalpha(img)
    return to_sprite(rgba)

def glow_of(spr, radius, color):
    a = Image.fromarray((spr[..., 3] * 255).astype(np.uint8))
    pad = radius * 3
    big = Image.new('L', (a.width + pad * 2, a.height + pad * 2)); big.paste(a, (pad, pad))
    big = big.filter(ImageFilter.GaussianBlur(radius))
    g = np.asarray(big, np.float32)[..., None] / 255
    out = np.concatenate([g * color, g], axis=2).astype(np.float32)
    return out, pad

def reveal(spr, p):
    """Left-to-right wipe of a sprite."""
    w = int(spr.shape[1] * clamp(p))
    return spr[:, :w] if w > 0 else None

def smear(spr, dx):
    """Directional motion blur along x by averaging shifted copies."""
    n = int(min(abs(dx) / 10, 14))
    if n < 2: return spr
    step = dx / n
    h, w = spr.shape[:2]
    pad = int(abs(dx)) + 2
    out = np.zeros((h, w + pad, 4), np.float32)
    for i in range(n):
        s = int(i * abs(step))
        if dx < 0: s = pad - 1 - s
        out[:, s:s + w] += spr
    return out / n, (-pad if dx < 0 else 0)

# ---------- assets ----------
CACHE = Path(__file__).resolve().parent / '.intro-cache'
def player_file(pid):
    """Full-size cut-out from fcb.cz (the kiosk copy is only 900 px tall); falls back to the kiosk copy."""
    text = (DIST / 'club-content.js').read_text(encoding='utf-8')
    content = json.loads(text[text.index('const content=') + 14:text.rindex('};if(') + 1])
    source = next((p.get('photoSource') for p in content['players'] if p['id'] == pid), None)
    target = CACHE / f'{pid}.png'
    if source and not target.exists():
        CACHE.mkdir(exist_ok=True)
        try:
            with urllib.request.urlopen(urllib.request.Request(source, headers={'User-Agent': 'BanikVIP-Intro/1.0'}), timeout=60) as r:
                target.write_bytes(r.read())
        except Exception as error:
            print('original photo unavailable:', pid, error)
    return target if target.exists() else DIST / 'assets' / 'players' / f'{pid}.png'

def load_player(pid, height):
    im = Image.open(player_file(pid)).convert('RGBA')
    im = im.crop(im.getchannel('A').getbbox())
    im = im.resize((int(im.width * height / im.height), height), Image.LANCZOS)
    return im

print('Preparing assets...')
crest = Image.open(DIST / 'assets' / 'club-logo.png').convert('RGBA')
logo_img = Image.new('RGBA', (max(crest.size),) * 2, (0, 0, 0, 0))  # square canvas, the crest is slightly taller than wide
logo_img.paste(crest, ((logo_img.width - crest.width) // 2, (logo_img.height - crest.height) // 2))
LOGO = to_sprite(logo_img.resize((LS, LS), Image.LANCZOS))
LOGO_GLOW, LOGO_GLOW_PAD = glow_of(LOGO, 38, LIGHT * 1.3)
LOGO_SMALL = to_sprite(logo_img.resize((86, 86), Image.LANCZOS))

HERO_IMGS = [load_player(h[0], 1350 if PORTRAIT else 1180) for h in HEROES]
HERO_SPR = [to_sprite(im) for im in HERO_IMGS]
HERO_RIM = []
for spr in HERO_SPR:  # light rim behind the player
    g, pad = glow_of(spr, 26, LIGHT)
    HERO_RIM.append((g, pad))
LINE_SPR = {pid: to_sprite(load_player(pid, (1100 if pid == LINEUP[2] else 900) if PORTRAIT else (860 if pid == LINEUP[2] else 760))) for pid in LINEUP}

HERO_TXT = []
for pid, first, last, num, pos in HEROES:
    HERO_TXT.append(dict(
        pos=text_sprite(pos, 34, (120, 200, 245), 'SemiBold', spacing=12),
        first=text_sprite(first.upper(), 72, (190, 210, 235), 'Light Condensed', spacing=4),
        last=text_sprite(last, 170, spacing=2),
        num=text_sprite(num, 760, (79, 179, 234), outline=5),
        jersey=text_sprite('#' + num, 64, (79, 179, 234), 'Bold Condensed'),
    ))
T_EYEBROW = text_sprite('FC BANÍK OSTRAVA', 40, (140, 205, 245), 'SemiBold', spacing=18)
T_PRESENTS = text_sprite('PŘEDSTAVUJE', 30, (150, 175, 205), 'Light', spacing=22)
T_SEASON = text_sprite('VIP KLUB', 30, (150, 175, 205), 'SemiBold', spacing=14)
TEAM_LINES = []
for txt, y in ((('MODROBÍLÉ', 230), ('SRDCE OSTRAVY', 390)) if PORTRAIT else (('MODROBÍLÉ SRDCE OSTRAVY', 90),)):
    spr = text_sprite(txt, 165 if PORTRAIT else 120, spacing=3)
    TEAM_LINES.append((spr, glow_of(spr, 18, BLUE * 1.4), y))
if PORTRAIT:
    HEAD_LINES = [(text_sprite('NA TRÁVNÍKU TÝM.', 132, spacing=2), 1110), (text_sprite('VE HŘE TY.', 140, spacing=2), 1265)]
    SUB_LINES = [(text_sprite('VIP TIPOVACÍ SOUTĚŽ', 40, (165, 210, 240), 'SemiBold', spacing=8), 1460), (text_sprite('TIPNI SKÓRE A VYHRAJ', 40, (165, 210, 240), 'SemiBold', spacing=8), 1520)]
else:
    HEAD_LINES = [(text_sprite('NA TRÁVNÍKU TÝM. VE HŘE TY.', 104, spacing=2), 705)]
    SUB_LINES = [(text_sprite('VIP TIPOVACÍ SOUTĚŽ  ·  TIPNI SKÓRE A VYHRAJ', 36, (165, 210, 240), 'SemiBold', spacing=6), 840)]
T_BRAND = text_sprite('BANÍK', 380, (255, 255, 255), 'Bold Condensed', spacing=24)

# small glowing dot for particles
def dot(r, color):
    s = r * 4 + 1
    yy, xx = np.mgrid[0:s, 0:s] - s // 2
    d = np.sqrt(xx ** 2 + yy ** 2)
    a = np.clip(1 - d / (r * 2), 0, 1) ** 2.2
    return np.concatenate([a[..., None] * color, a[..., None]], axis=2).astype(np.float32)
DOTS = [dot(r, WHITE * 0.9 + LIGHT * 0.3) for r in (1, 2, 3, 5)]

# static background: navy gradient + vignette + grain
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
nx, ny = (xx - W / 2) / (W / 2), (yy - H / 2) / (H / 2)
vign = np.clip(1 - 0.55 * (nx ** 2 * 0.7 + ny ** 2), 0.15, 1)[..., None]
base = (NAVY * 0.55 + (BLUE * 0.25) * np.clip(1 - np.sqrt(nx ** 2 * 0.5 + (ny + 0.15) ** 2), 0, 1)[..., None]) * vign
noise = np.asarray(Image.effect_noise((W // 4, H // 4), 40).resize((W, H), Image.BICUBIC), np.float32)[..., None] / 255
BG = (base * (0.85 + 0.3 * noise)).astype(np.float32)
# bottom mist that hides the cut of roster photos
mist_a = np.clip((yy - H * 0.65) / (H * 0.35), 0, 1) ** 1.6
MIST = np.concatenate([(NAVY * 0.6)[None, None] * np.ones((H, W, 1)) * mist_a[..., None], mist_a[..., None]], axis=2).astype(np.float32)
MIST_FULL = MIST.copy()
# football pitch in perspective (mowing stripes, halfway line, centre circle), drawn once
rink = Image.new('L', (W, H), 0); dr = ImageDraw.Draw(rink)
horizon, vx = H * 0.68, W / 2
def floor_x(u, y):  # u = -1..1 across the pitch, projected towards the vanishing point
    return vx + u * (W * 0.18 + (y - horizon) / (H - horizon) * W * 1.25)
for k in range(-6, 6):  # alternating mowing stripes
    if k % 2: dr.polygon([(floor_x(k / 6, horizon), horizon), (floor_x((k + 1) / 6, horizon), horizon), (floor_x((k + 1) / 6, H), H), (floor_x(k / 6, H), H)], fill=10)
for u in (-1, 1):  # touchlines
    dr.line([(floor_x(u, horizon), horizon), (floor_x(u, H), H)], fill=40, width=3)
dr.line([(floor_x(-1, horizon), horizon), (floor_x(1, horizon), horizon)], fill=30, width=2)
yc = horizon + (H - horizon) * 0.55  # halfway line and centre circle
dr.line([(floor_x(-1, yc), yc), (floor_x(1, yc), yc)], fill=40, width=3)
rx, ry = W * 0.2, (H - horizon) * 0.16
dr.ellipse([vx - rx, yc - ry, vx + rx, yc + ry], outline=40, width=3)
dr.ellipse([vx - 6, yc - 4, vx + 6, yc + 4], fill=60)
RINK = np.asarray(rink.filter(ImageFilter.GaussianBlur(1.2)), np.float32)[..., None] / 255 * LIGHT

# half-resolution spotlight maps
hy, hx = np.mgrid[0:H // 2, 0:W // 2].astype(np.float32) * 2
SPOTS = []
for sx in (W * 0.18, W * 0.82, W * 0.5):
    ang = np.arctan2(hx - sx, hy + 200)
    dist = np.sqrt((hx - sx) ** 2 + (hy + 200) ** 2)
    SPOTS.append((ang, np.clip(1.25 - dist / 1500, 0, 1)))

def spotlights(t, strength):
    acc = np.zeros((H // 2, W // 2), np.float32)
    for i, (ang, fall) in enumerate(SPOTS):
        theta = math.sin(t * 0.7 + i * 2.1) * 0.45 + (0.25 if i == 0 else -0.25 if i == 1 else 0)
        acc += np.exp(-((ang - theta) / 0.11) ** 2) * fall * (0.5 if i == 2 else 1)
    img = Image.fromarray(acc).resize((W, H), Image.BILINEAR)
    return np.asarray(img, np.float32)[..., None] * (LIGHT * 0.35 + 0.05) * strength

# rays behind logo / lineup (rotated per frame)
def make_rays(size, n):
    im = Image.new('L', (size, size), 0); d = ImageDraw.Draw(im); c = size / 2
    for i in range(n):
        a0 = i * 2 * math.pi / n; a1 = a0 + math.pi / n * 0.45
        d.polygon([(c, c), (c + math.cos(a0) * c * 1.5, c + math.sin(a0) * c * 1.5), (c + math.cos(a1) * c * 1.5, c + math.sin(a1) * c * 1.5)], fill=255)
    im = im.filter(ImageFilter.GaussianBlur(10))
    yy2, xx2 = np.mgrid[0:size, 0:size]; r = np.sqrt((xx2 - c) ** 2 + (yy2 - c) ** 2) / c
    fade = np.clip(1 - r, 0, 1) ** 1.4
    return Image.fromarray((np.asarray(im, np.float32) * fade).astype(np.uint8))
RAYS = make_rays(1700, 18)

def rays_sprite(angle, op, color):
    r = np.asarray(RAYS.rotate(angle, resample=Image.BILINEAR), np.float32)[..., None] / 255
    return np.concatenate([r * color * op, r * 0], axis=2)

def ring(radius, width, color):
    s = int(radius * 2 + width * 4 + 4)
    yy2, xx2 = np.mgrid[0:s, 0:s] - s / 2
    d = np.abs(np.sqrt(xx2 ** 2 + yy2 ** 2) - radius)
    a = np.exp(-(d / width) ** 2)
    return np.concatenate([a[..., None] * color, a[..., None] * 0], axis=2).astype(np.float32)

# ---------- particles ----------
class Particles:
    def __init__(self): self.p = []
    def burst(self, x, y, n, speed, spread=math.pi, direction=-math.pi / 2, life=1.2, gravity=600):
        for _ in range(n):
            a = direction + rng.uniform(-spread / 2, spread / 2)
            v = speed * rng.uniform(0.25, 1)
            self.p.append([x, y, math.cos(a) * v, math.sin(a) * v, 0.0, life * rng.uniform(0.5, 1), rng.randrange(4) if rng.random() < .3 else rng.randrange(2), gravity])
    def step_draw(self, frame, dt):
        alive = []
        for q in self.p:
            q[4] += dt
            if q[4] >= q[5]: continue
            q[2] *= 0.985; q[3] = q[3] * 0.985 + q[7] * dt
            q[0] += q[2] * dt; q[1] += q[3] * dt
            spr = DOTS[q[6]]
            add(frame, spr, q[0] - spr.shape[1] / 2, q[1] - spr.shape[0] / 2, (1 - q[4] / q[5]) ** 1.5 * 1.2)
            alive.append(q)
        self.p = alive

SNOW = [[rng.uniform(0, W), rng.uniform(0, H), rng.uniform(0.3, 1)] for _ in range(140)]
def snow(frame, t, op):
    for x, y, z in SNOW:
        px = (x + t * 40 * z + math.sin(t * 0.8 + y) * 20) % W
        py = (y - t * 25 * z) % H
        add(frame, DOTS[0 if z < .7 else 1], px, py, op * z * 0.5)

def slash(frame, t):
    """Diagonal blue wipe that hides each hard cut."""
    for c in CUTS:
        p = (t - (c - 0.22)) / 0.44
        if 0 <= p <= 1:
            x = -2800 + p * (W + 5600)
            m = Image.new('L', (W, H), 0); d = ImageDraw.Draw(m)
            d.polygon([(x, 0), (x + 2400, 0), (x + 2400 - 700, H), (x - 700, H)], fill=255)
            e = Image.new('L', (W, H), 0); de = ImageDraw.Draw(e)
            de.line([(x + 2400, 0), (x + 1700, H)], fill=255, width=26)
            de.line([(x + 2460, 0), (x + 1760, H)], fill=120, width=8)
            e = e.filter(ImageFilter.GaussianBlur(6))
            ma = np.asarray(m, np.float32)[..., None] / 255
            col = BLUE * (0.65 + 0.35 * (1 - ny[..., None] ** 2))
            frame[:] = frame * (1 - ma) + col * ma
            frame += np.asarray(e, np.float32)[..., None] / 255 * (WHITE * 0.8 + LIGHT * 0.4)
            # speed lines inside the band
            sl = Image.new('L', (W, H), 0); ds = ImageDraw.Draw(sl)
            r2 = random.Random(int(c * 10))
            for _ in range(26):
                yy0 = r2.uniform(0, H); ln = r2.uniform(200, 900); off = r2.uniform(0, 2000)
                xx0 = x + off - yy0 * 0.65
                ds.line([(xx0, yy0), (xx0 + ln, yy0)], fill=int(r2.uniform(40, 140)), width=r2.choice([2, 3, 5]))
            frame += np.asarray(sl, np.float32)[..., None] / 255 * ma * LIGHT

# ---------- scenes ----------
parts = Particles()
fired = set()
def once(key):
    if key in fired: return False
    fired.add(key); return True

def center_blit(f, spr, y, op=1.0, p=1.0, dy=0.0):
    s = reveal(spr, p)
    if s is not None: blit(f, s, W / 2 - spr.shape[1] / 2, y + dy, op)

def scene_open(f, t):
    f += spotlights(t, prog(t, 0.0, 1.2))
    f += RINK * prog(t, 0.3, 1.5) * 0.8
    # ball shot across the pitch: a curling arc with a light trail
    p = prog(t, 0.55, 1.25)
    if 0 < p < 1:
        e = out_cubic(p)
        px = -200 + e * (W + 400); py = H * 0.78 - math.sin(e * math.pi) * H * 0.22
        tail = Image.new('L', (W, H), 0); d = ImageDraw.Draw(tail)
        pts = []
        for k in range(24):
            ek = max(0.0, e - k * 0.012)
            pts.append((-200 + ek * (W + 400), H * 0.78 - math.sin(ek * math.pi) * H * 0.22))
        for k in range(len(pts) - 1):
            d.line([pts[k], pts[k + 1]], fill=int(230 * (1 - k / len(pts))), width=max(2, 16 - k // 2))
        d.ellipse([px - 17, py - 17, px + 17, py + 17], fill=255)
        tail = np.asarray(tail.filter(ImageFilter.GaussianBlur(3)), np.float32)[..., None] / 255
        f += tail * (WHITE * 0.7 + LIGHT * 0.6)
        if int(t * FPS) % 2 == 0: parts.burst(px, py, 14, 500, spread=1.2, direction=math.pi * 0.95, life=0.8, gravity=300)
    a = prog(t, 0.9, 1.6)
    if a > 0:
        cy = H / 2 - 10
        center_blit(f, T_EYEBROW, cy - 70, a, out_cubic(a))
        center_blit(f, T_PRESENTS, cy + 5, prog(t, 1.3, 2.0) * 0.9, out_cubic(prog(t, 1.3, 2.0)))
        ln = int(min(560, W - 200) * out_expo(prog(t, 1.0, 1.8)))
        f[int(cy) - 12:int(cy) - 10, W // 2 - ln // 2:W // 2 + ln // 2] += LIGHT * 0.9

def scene_hero(f, t, i):
    lt = t - (HERO_START + i * HERO_LEN)
    side = 1 if i % 2 == 0 else -1  # 1 = player on the right
    spr, (rim, rpad), tx = HERO_SPR[i], HERO_RIM[i], HERO_TXT[i]
    f += spotlights(t, 0.9)
    f += RINK * 0.7
    # big outline number drifting the other way
    num = tx['num']
    drift = -side * lt * 40 + side * (1 - out_expo(prog(lt, 0.1, 0.8))) * 500
    if PORTRAIT: blit(f, num, W / 2 - num.shape[1] / 2 + drift, 610, 0.45 * prog(lt, 0.1, 0.5))
    else: blit(f, num, (W * 0.6 if side == 1 else W * 0.1) + drift, 120, 0.5 * prog(lt, 0.1, 0.5))
    # player
    e = out_expo(prog(lt, 0.0, 0.55))
    zoom = 1 + lt * 0.022
    ph, pw = spr.shape[:2]
    target_x = (W / 2 + side * 40 if PORTRAIT else (W * 0.70 if side == 1 else W * 0.30)) - pw / 2
    x = target_x + side * (1 - e) * 1600
    y = H - ph + (120 if PORTRAIT else 150) - (zoom - 1) * 300
    vel = side * 1600 * (out_expo(prog(lt, 0.0, 0.55)) - out_expo(prog(lt - 1 / FPS, 0.0, 0.55)))
    add(f, rim, x - rpad, y - rpad - 8, 0.9 * prog(lt, 0.25, 0.7))
    cur = spr
    if zoom > 1.001 and abs(vel) < 4:
        nh, nw = int(ph * zoom), int(pw * zoom)
        cur = to_sprite(HERO_IMGS[i].resize((nw, nh), Image.BILINEAR)); x -= (nw - pw) / 2
    sm = smear(cur, -vel * 0.9)
    if isinstance(sm, tuple): blit(f, sm[0], x + sm[1], y)
    else: blit(f, sm, x, y)
    if lt > 0.42 and once(('spray', i)):
        parts.burst(target_x + pw / 2 - side * 120, H - 120, 160, 1300, spread=1.4, direction=-math.pi / 2 - side * 0.7, life=1.1, gravity=1400)
    # text block
    if PORTRAIT: tx0, ty = 90, 190
    else: tx0, ty = (W * 0.08 if side == 1 else W * 0.56), 360
    for key, yy0, a0, a1 in (('pos', 0, 0.35, 0.8), ('first', 60, 0.45, 0.9), ('last', 135, 0.5, 1.0)):
        s = reveal(tx[key], out_expo(prog(lt, a0, a1)))
        if s is not None: blit(f, s, tx0 + (1 - out_expo(prog(lt, a0, a1))) * -40 * side, ty + yy0)
    bar = int(140 * out_expo(prog(lt, 0.6, 1.1)))
    f[ty + 330:ty + 336, int(tx0):int(tx0) + bar] = RED * 1.1  # crest red accent
    s = reveal(tx['jersey'], out_expo(prog(lt, 0.7, 1.2)))
    if s is not None: blit(f, s, tx0 + bar + 24, ty + 304)

def scene_lineup(f, t):
    lt = t - LINEUP_START
    f += spotlights(t, 1.0)
    f += RINK * 0.8
    add(f, rays_sprite(lt * 8, 0.35 * prog(lt, 0, 0.8), LIGHT), W / 2 - 850, (900 if PORTRAIT else 380) - 850)
    if PORTRAIT:
        order = [(LINEUP[0], -330, 0.35, 0.55, -260), (LINEUP[4], 330, 0.35, 0.55, -260), (LINEUP[1], -200, 0.2, 0.78, -120), (LINEUP[3], 200, 0.2, 0.78, -120), (LINEUP[2], 0, 0.0, 1.0, 0)]
    else:
        order = [(LINEUP[0], -660, 0.35, 0.62, 0), (LINEUP[4], 660, 0.35, 0.62, 0), (LINEUP[1], -360, 0.2, 0.8, 0), (LINEUP[3], 360, 0.2, 0.8, 0), (LINEUP[2], 0, 0.0, 1.0, 0)]
    for pid, dx, delay, bright, lift in order:
        spr = LINE_SPR[pid]; ph, pw = spr.shape[:2]
        e = out_expo(prog(lt, delay, delay + 0.7))
        x = W / 2 + dx * (0.9 + 0.1 * e) - pw / 2 + dx * lt * 0.015
        y = H - ph + 120 + lift + (1 - e) * 500
        tmp = spr.copy(); tmp[..., :3] *= bright
        blit(f, tmp, x, y, e)
        if e > 0.05 and once(('lu', pid)):
            parts.burst(W / 2 + dx, H - 140, 60, 900, spread=1.8, life=1.0, gravity=1200)
    blit(f, MIST, 0, 0)
    for k, (spr, glow, y) in enumerate(TEAM_LINES):
        a = prog(lt, 1.0 + k * 0.25, 1.6 + k * 0.25)
        if a > 0:
            add(f, glow[0], W / 2 - spr.shape[1] / 2 - glow[1], y - glow[1], 0.8 * a)
            center_blit(f, spr, y, 1.0, out_expo(a))

def scene_logo(f, t):
    lt = t - LOGO_START
    f += spotlights(t, 0.7)
    # giant faint wordmark sliding behind
    blit(f, T_BRAND, W / 2 - T_BRAND.shape[1] / 2 - 120 + lt * 30, H * 0.52, 0.04 * prog(lt, 0.2, 1.2))
    cx, cy, half = W / 2, LOGO_CY, LS // 2
    add(f, rays_sprite(-lt * 10, 0.55 * prog(lt, 0.0, 0.8), LIGHT * 0.9 + BLUE * 0.4), cx - 850, cy - 850)
    for k in range(3):  # shockwaves
        p = prog(lt, 0.05 + k * 0.18, 1.1 + k * 0.18)
        if 0 < p < 1:
            rr = ring(80 + out_cubic(p) * 900, 6 + 14 * p, WHITE * 0.6 + LIGHT * 0.6)
            add(f, rr, cx - rr.shape[1] / 2, cy - rr.shape[0] / 2, (1 - p) ** 1.5)
    if once('logo-burst'):
        parts.burst(cx, cy, 380, 1700, spread=math.tau, life=1.6, gravity=250)
    e = prog(lt, 0.0, 0.9)
    sc = 2.4 - 1.4 * out_back(e, 1.3) if e < 1 else 1.0
    sc *= 1 + 0.012 * math.sin(lt * 1.6)
    size = int(LS * sc)
    logo = to_sprite(logo_img.resize((size, size), Image.BILINEAR)) if abs(sc - 1) > 0.002 else LOGO
    gl_op = 0.55 + 0.25 * math.sin(lt * 2.2)
    if abs(sc - 1) < 0.05: add(f, LOGO_GLOW, cx - half - LOGO_GLOW_PAD, cy - half - LOGO_GLOW_PAD, gl_op * prog(lt, 0.4, 1.0))
    blit(f, logo, cx - size / 2, cy - size / 2, prog(lt, 0.0, 0.25))
    # glint sweeping across the logo
    gp = prog(lt, 2.3, 3.1)
    if 0 < gp < 1:
        band = Image.new('L', (LS, LS), 0); d = ImageDraw.Draw(band)
        bx = -300 + gp * (LS + 580)
        d.polygon([(bx, 0), (bx + 90, 0), (bx - 110, LS), (bx - 200, LS)], fill=255)
        band = np.asarray(band.filter(ImageFilter.GaussianBlur(14)), np.float32) / 255
        g = (band * LOGO[..., 3])[..., None]
        f[int(cy - half):int(cy - half) + LS, int(cx - half):int(cx - half) + LS] += g * 0.9
    # headline + call to action
    for k, (spr, y) in enumerate(HEAD_LINES):
        a = prog(lt, 1.2 + k * 0.2, 1.9 + k * 0.2)
        center_blit(f, spr, y, 1.0, out_expo(a), (1 - out_expo(a)) * 30)
    for k, (spr, y) in enumerate(SUB_LINES):
        a2 = prog(lt, 1.8 + k * 0.15, 2.5 + k * 0.15)
        if a2 > 0: center_blit(f, spr, y, a2, 1.0, (1 - out_cubic(a2)) * 20)
    # (the touch prompt is drawn by the kiosk page over the video, not baked in)
    # flash
    fl = 1 - prog(lt, 0.0, 0.5)
    if fl > 0: f += (WHITE * 0.8 + LIGHT * 0.2) * fl ** 2

def hud(f, t):
    """Broadcast-style corner badges during player shots."""
    a = prog(t, HERO_START + 0.3, HERO_START + 0.9) * (1 - prog(t, LOGO_START - 0.3, LOGO_START))
    if a <= 0: return
    blit(f, LOGO_SMALL, 60, 52, a)
    blit(f, T_SEASON, 165, 82, a * 0.9)
    f[62:128, 154:156] += LIGHT * 0.5 * a

def render(t):
    f = BG.copy()
    if t < HERO_START: scene_open(f, t)
    elif t < LINEUP_START: scene_hero(f, t, int((t - HERO_START) // HERO_LEN))
    elif t < LOGO_START: scene_lineup(f, t)
    else: scene_logo(f, t)
    if HERO_START <= t < LINEUP_START: blit(f, MIST, 0, 0, 0.85)
    snow(f, t, 1.0)
    parts.step_draw(f, 1 / FPS)
    hud(f, t)
    slash(f, t)
    fade = min(prog(t, 0, 0.6), 1 - prog(t, DURATION - 0.7, DURATION))
    f *= fade
    return np.clip(f * 255, 0, 255).astype(np.uint8)

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    if '--preview' in sys.argv:
        for t in [float(x) for x in sys.argv[sys.argv.index('--preview') + 1:]]:
            global parts, fired
            parts, fired = Particles(), set()
            for k in range(max(0, int(t * FPS) - 30), int(t * FPS)): render(k / FPS)  # warm particles
            Image.fromarray(render(t)).save(f'preview-{NAME}-{t:05.1f}.png')  # written to the current directory
        return
    frames = int(DURATION * FPS)
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
           '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(OUT / f'{NAME}.mp4')]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    poster = None
    for k in range(frames):
        t = k / FPS
        fr = render(t)
        if abs(t - (LOGO_START + 3.6)) < 0.5 / FPS: poster = fr
        proc.stdin.write(fr.tobytes())
        if k % 60 == 0: print(f'frame {k}/{frames}', flush=True)
    proc.stdin.close(); proc.wait()
    if poster is not None: Image.fromarray(poster).save(OUT / f'{NAME}-poster.jpg', quality=85)
    print('Done:', OUT / f'{NAME}.mp4')

if __name__ == '__main__':
    main()
