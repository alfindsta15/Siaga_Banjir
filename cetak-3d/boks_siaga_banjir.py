"""
Boks sensor SIAGA BANJIR - model parametrik (satuan: mm)
Menghasilkan 6 berkas STL:
  boks_dasar.stl        dasar boks polos
  boks_dasar_klem.stl   dasar boks + klem pegangan probe (collar belah)
  tutup_boks.stl        tutup + telinga pemasangan
  pelindung_sensor.stl  corong pelindung di bawah sensor
  dudukan_tiang.stl     pelat + cradle untuk tiang/pipa (diikat strap/kabel ties)
  spacer_dudukan.stl    4 spacer penjarak (cetak 1 kali, isi 4 buah)
Jalankan:  pip install manifold3d trimesh numpy
           python boks_siaga_banjir.py
Ubah angka di bagian PARAMETER, lalu jalankan ulang.
"""
import numpy as np, trimesh
from manifold3d import Manifold, CrossSection, JoinType

# ================= PARAMETER (UBAH SESUAI KOMPONEN ANDA) =================
L, W, H   = 130.0, 90.0, 50.0   # ukuran luar boks
WALL, FLOOR, R = 3.0, 3.0, 5.0  # tebal dinding, tebal lantai, radius sudut
LID_T, LIP_H, LIP_T, CLR = 3.0, 3.0, 2.0, 0.4
BOSS_D, SCREW_PILOT, SCREW_CLEAR = 9.0, 2.7, 3.4
PROBE_D   = 24.0                # UKUR diameter probe JSN-SR04T Anda!
PROBE_POS = (-46.0, 0.0)
GLAND_D, GLAND_Y, GLAND_Z = 12.5, (-15.0, 15.0), 28.0
EAR_LEN, EAR_W, EAR_HOLE, EAR_HOLE_X = 50.0, 14.0, 5.5, (-15.0, 15.0)
RAIL_H, RAIL_T, FIT = 6.0, 1.6, 0.6
POCKETS = [  # (nama, panjang x, lebar y, pusat x, pusat y)
    ("baterai 2x18650", 80.0, 42.0, 10.0, -20.0),
    ("ESP32 DevKit",    53.0, 29.0, 22.0,  24.0),
    ("TP4056",          28.0, 19.0, -24.0, 26.0),
]
# klem probe
COLLAR_WALL, COLLAR_H = 4.0, 14.0
# pelindung sensor (corong)
HOOD_H, HOOD_WALL, HOOD_R_BOTTOM, HOOD_FLANGE_R, HOOD_FLANGE_T = 26.0, 2.5, 34.0, 23.0, 2.5
# dudukan tiang
POLE_D, PLATE_T, PLATE_X = 48.0, 4.0, 50.0
SPACER_H, SPACER_D = 6.0, 12.0
STRAP_SLOT = (14.0, 4.0)        # lebar strap/kabel ties maks 12 mm
SEG = 64
# ========================================================================

def rr(l, w, r):
    return CrossSection.square((l - 2*r, w - 2*r), center=True).offset(r, JoinType.Round, 2.0, SEG)

def box(l, w, h, cx=0, cy=0, z0=0):
    return Manifold.cube((l, w, h), True).translate((cx, cy, z0 + h/2))

def cyl(d, h, x=0, y=0, z0=0):
    return Manifold.cylinder(h, d/2, d/2, SEG, False).translate((x, y, z0))

def cyl_x(d, length, x0, y, z, seg=SEG):
    c = Manifold.cylinder(length, d/2, d/2, seg, False).rotate((0, 90, 0))
    return c.translate((x0, y, z))

bx = L/2 - WALL - 5.0
by = W/2 - WALL - 5.0
BOSS_XY = [(sx*bx, sy*by) for sx in (-1, 1) for sy in (-1, 1)]
px, py = PROBE_POS

def make_base(collar=False):
    outer  = Manifold.extrude(rr(L, W, R), H)
    cavity = Manifold.extrude(rr(L - 2*WALL, W - 2*WALL, R - WALL), H).translate((0, 0, FLOOR))
    base = outer - cavity
    for (x, y) in BOSS_XY:
        base = base + cyl(BOSS_D, H - FLOOR + 0.5, x, y, FLOOR - 0.5)
    for (_, pl, pw, cx, cy) in POCKETS:
        ring = box(pl + 2*FIT + 2*RAIL_T, pw + 2*FIT + 2*RAIL_T, RAIL_H, cx, cy, FLOOR - 0.2) \
             - box(pl + 2*FIT, pw + 2*FIT, RAIL_H + 2, cx, cy, FLOOR - 1)
        base = base + ring
    if collar:
        od = PROBE_D + 2*COLLAR_WALL
        base = base + cyl(od, COLLAR_H, px, py, FLOOR - 0.5)
        base = base + box(12.0, 15.0, COLLAR_H, px, py - 19.5, FLOOR - 0.5 + 0.5)   # telinga baut klem
    for (x, y) in BOSS_XY:
        base = base - cyl(SCREW_PILOT, 16, x, y, H - 15.0)
    base = base - cyl(PROBE_D, FLOOR + COLLAR_H + 4, px, py, -2)
    if collar:
        zc = FLOOR + COLLAR_H/2
        yb = py - 21.0
        base = base - box(1.6, 29.0, COLLAR_H + 2, px, py - 14.0, FLOOR)              # celah belah
        base = base - cyl_x(3.4, 20.0, px - 10, yb, zc)                                # lubang baut M3
        base = base - cyl_x(6.4, 3.2, px - 6.5, yb, zc)                                # tempat kepala baut
        hexnut = Manifold.cylinder(3.0, 3.35, 3.35, 6, False).rotate((0, 90, 0)).translate((px + 3.4, yb, zc))
        base = base - hexnut                                                            # tempat mur M3
    for gy in GLAND_Y:
        base = base - cyl_x(GLAND_D, WALL + 10, L/2 - WALL - 5, gy, GLAND_Z)
    return base

def make_lid():
    plate = rr(L, W, R)
    ear = CrossSection.square((EAR_LEN, EAR_W + 6), True)
    ears = ear.translate((0, W/2 + EAR_W/2 - 3)) + ear.translate((0, -(W/2 + EAR_W/2 - 3)))
    ears = ears.offset(2.0, JoinType.Round, 2.0, 32)
    lid = Manifold.extrude(plate + ears, LID_T)
    lip_out = Manifold.extrude(rr(L - 2*WALL - 2*CLR, W - 2*WALL - 2*CLR, max(R - WALL - CLR, 0.5)), LIP_H)
    lip_in  = Manifold.extrude(rr(L - 2*WALL - 2*CLR - 2*LIP_T, W - 2*WALL - 2*CLR - 2*LIP_T, 1.0), LIP_H + 2).translate((0, 0, -1))
    lip = (lip_out - lip_in).translate((0, 0, LID_T))
    for (x, y) in BOSS_XY:
        lip = lip - cyl(BOSS_D + 1.2, LIP_H + 2, x, y, LID_T - 1)
    lid = lid + lip
    for (x, y) in BOSS_XY:
        lid = lid - cyl(SCREW_CLEAR, LID_T + 2, x, y, -1)
        lid = lid - Manifold.cylinder(1.6, 3.5, SCREW_CLEAR/2, SEG, False).translate((x, y, -0.01))
    for sgn in (-1, 1):
        for hx in EAR_HOLE_X:
            lid = lid - cyl(EAR_HOLE, LID_T + 2, hx, sgn*(W/2 + EAR_W/2), -1)
    return lid

def make_hood():
    # dicetak dengan ujung lebar di meja cetak (z=0), flange di atas
    r_top_in = PROBE_D/2 + 0.3
    outer = Manifold.cylinder(HOOD_H, HOOD_R_BOTTOM + HOOD_WALL, r_top_in + HOOD_WALL, SEG, False)
    inner = Manifold.cylinder(HOOD_H + 0.02, HOOD_R_BOTTOM, r_top_in, SEG, False).translate((0, 0, -0.01))
    flange = cyl(2*HOOD_FLANGE_R, HOOD_FLANGE_T, 0, 0, HOOD_H - 0.01)
    hood = (outer - inner) + flange
    hood = hood - cyl(2*r_top_in, HOOD_H + HOOD_FLANGE_T + 2, 0, 0, -1)
    return hood

def make_bracket():
    ear_y = W/2 + EAR_W/2
    pr = POLE_D/2 + 0.4
    cradle_y = pr + 9.0
    zc = PLATE_T + 4.0 + POLE_D/2
    top = zc + 10.0
    plate = Manifold.extrude(rr(PLATE_X, 2*(ear_y + 10), 4.0), PLATE_T)
    cradle = box(PLATE_X, 2*cradle_y, top - PLATE_T + 0.01, 0, 0, PLATE_T - 0.01)
    br = plate + cradle
    br = br - cyl_x(2*pr, PLATE_X + 4, -PLATE_X/2 - 2, 0, zc, seg=96)
    for sgn in (-1, 1):
        for hx in EAR_HOLE_X:
            br = br - cyl(EAR_HOLE, PLATE_T + 2, hx, sgn*ear_y, -1)
        for sx in (-12.0, 12.0):
            br = br - box(STRAP_SLOT[0], STRAP_SLOT[1], PLATE_T + 2, sx, sgn*(cradle_y + 3.5), -1)
    return br

def make_spacers():
    s = None
    for i in range(4):
        one = cyl(SPACER_D, SPACER_H, i*(SPACER_D + 4), 0, 0) - cyl(EAR_HOLE, SPACER_H + 2, i*(SPACER_D + 4), 0, -1)
        s = one if s is None else s + one
    return s

def export(m, name):
    mesh = m.to_mesh()
    tm = trimesh.Trimesh(vertices=np.asarray(mesh.vert_properties)[:, :3], faces=np.asarray(mesh.tri_verts))
    tm.merge_vertices(); tm.export(name)
    return tm

if __name__ == "__main__":
    parts = {"boks_dasar": make_base(False), "boks_dasar_klem": make_base(True), "tutup_boks": make_lid(),
             "pelindung_sensor": make_hood(), "dudukan_tiang": make_bracket(), "spacer_dudukan": make_spacers()}
    for n, m in parts.items():
        t = export(m, n + ".stl")
        print(f"{n:18s} watertight={t.is_watertight}  ukuran(mm)={np.round(t.extents,1)}  volume={t.volume/1000:.1f} cm3")
