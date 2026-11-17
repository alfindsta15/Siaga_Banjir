// Uji logika kalibrasi maket (firmware/desa_siaga_banjir/logika_maket.h) di komputer:
//   g++ -std=c++11 -Wall -Wextra -I firmware/desa_siaga_banjir tools/uji_logika_maket.cpp -o /tmp/uji_maket && /tmp/uji_maket
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include "logika_maket.h"

static int pass = 0, fail = 0;
#define CEK(nama, kond) do { if (kond) { pass++; printf("LULUS  %s\n", nama); } else { fail++; printf("GAGAL  %s\n", nama); } } while (0)

static unsigned long rs = 12345UL;
static float rnd() { rs = (rs * 1103515245UL + 12345UL) & 0x7fffffffUL; return (float)rs / 2147483647.0f; }   // 0..1
static float derau(float amp) { return (rnd() - 0.5f) * 2.0f * amp; }

static GeomMaket tinwall() { GeomMaket g; g.d0 = 10.0f; g.tinggi = 7.5f; g.margin = 1.0f; g.minJarak = 2.0f; g.zeroBand = 0.25f; g.maxLonjakan = 1.0f; return g; }

int main() {
  GeomMaket g = tinwall();

  printf("== Pemetaan jarak -> tinggi (tinwall 7,5 cm, sensor 10 cm di atas dasar) ==\n");
  CEK("tangki kosong (jarak 10,0) = 0 cm", fabsf(levelMentah(g, 1, 0, 10.0f)) < 1e-6f);
  CEK("jarak 7,5 = 2,5 cm (WASPADA)", fabsf(levelMentah(g, 1, 0, 7.5f) - 2.5f) < 1e-5f);
  CEK("jarak 5,5 = 4,5 cm (SIAGA)", fabsf(levelMentah(g, 1, 0, 5.5f) - 4.5f) < 1e-5f);
  CEK("jarak 4,0 = 6,0 cm (AWAS)", fabsf(levelMentah(g, 1, 0, 4.0f) - 6.0f) < 1e-5f);
  CEK("jarak 2,5 = 7,5 cm (penuh, tepat bibir)", fabsf(levelMentah(g, 1, 0, 2.5f) - 7.5f) < 1e-5f);
  CEK("jarak 10,4 (lewat dasar sedikit) = 0, BUKAN minus", levelMentah(g, 1, 0, 10.4f) == 0.0f);
  CEK("jarak 2,1 (air di atas bibir) dipotong 7,5", levelMentah(g, 1, 0, 2.1f) == 7.5f);
  bool tak_minus = true; for (float d = 0.5f; d < 60.0f; d += 0.05f) if (levelMentah(g, 1, 0, d) < 0.0f) tak_minus = false;
  CEK("untuk SEMUA jarak 0,5-60 cm tinggi tidak pernah minus", tak_minus);

  printf("== Jendela jarak (bacaan mustahil ditolak) ==\n");
  CEK("10,0 dan 10,9 valid (dasar + toleransi)", jendela(g, 10.0f) == V_OK && jendela(g, 10.9f) == V_OK);
  CEK("11,5 terlalu jauh (sensor miring / dasar salah)", jendela(g, 11.5f) == V_JAUH);
  CEK("400 cm (tidak ada pantulan/di luar) terlalu jauh", jendela(g, 400.0f) == V_JAUH);
  CEK("1,8 cm terlalu dekat (di bawah batas HC-SR04)", jendela(g, 1.8f) == V_DEKAT);
  CEK("2,3 cm masih valid (hampir penuh)", jendela(g, 2.3f) == V_OK);

  printf("== Tangki kosong dengan derau +-0,3 cm (3000 bacaan) ==\n");
  { FilterLevel f; resetFilter(f); float mx = 0, mn = 99; int tak_ok = 0;
    for (int i = 0; i < 3000; i++) { float d = 10.0f + derau(0.3f); if (jendela(g, d) != V_OK) { tak_ok++; continue; } langkah(f, g, levelMentah(g, 1, 0, d), 0.4f, 3); if (f.nilai > mx) mx = f.nilai; if (f.nilai < mn) mn = f.nilai; }
    printf("   tinggi tersaring: min %.3f maks %.3f, bacaan ditolak %d\n", mn, mx, tak_ok);
    CEK("tangki kosong: tinggi tersaring tidak pernah minus", mn >= 0.0f);
    CEK("tangki kosong: derau tidak menjadi air > 0,35 cm (tidak 'halusinasi' WASPADA)", mx < 0.35f);
    CEK("tangki kosong: tidak ada bacaan ditolak (derau masih dalam jendela)", tak_ok == 0); }

  printf("== Lonjakan / percikan ==\n");
  { FilterLevel f; resetFilter(f); for (int i = 0; i < 20; i++) langkah(f, g, 3.0f + derau(0.1f), 0.4f, 3);
    Vonis v1 = langkah(f, g, 7.0f, 0.4f, 3); float setelah1 = f.nilai;
    CEK("satu lonjakan +4 cm ditolak, tinggi tetap ~3", v1 == V_LONJAKAN && fabsf(setelah1 - 3.0f) < 0.25f);
    langkah(f, g, 7.0f, 0.4f, 3); langkah(f, g, 7.0f, 0.4f, 3);
    CEK("tiga lonjakan beruntun masih ditolak (tinggi tetap ~3)", fabsf(f.nilai - 3.0f) < 0.25f);
    Vonis v4 = langkah(f, g, 7.0f, 0.4f, 3);
    CEK("lonjakan yang BERTAHAN (ke-4) diikuti sebagai perubahan nyata", v4 == V_OK && f.nilai > 3.5f);
    FilterLevel h; resetFilter(h); for (int i = 0; i < 20; i++) langkah(h, g, 0.0f, 0.4f, 3);
    langkah(h, g, 6.5f, 0.4f, 3);
    CEK("satu percikan di tangki kosong tidak memicu AWAS", h.nilai < 0.3f); }

  printf("== Simulasi pengisian pompa 0 -> 6,5 cm (0,15 cm/dtk), derau +-0,3, percikan 3%% ==\n");
  { FilterLevel f; resetFilter(f); float benar = 0; int waspada_t = -1, siaga_t = -1, awas_t = -1, benarW = -1, benarS = -1, benarA = -1; float galatMaks = 0, mn = 99; int dipakai = 0;
    for (int t = 0; t < 60; t++) { benar = 0.15f * t; if (benar > 6.5f) benar = 6.5f;
      float d = g.d0 - benar + derau(0.3f); if (rnd() < 0.03f) d += (rnd() < 0.5f ? 3.0f : -3.0f);
      if (jendela(g, d) != V_OK) continue; dipakai++;
      langkah(f, g, levelMentah(g, 1, 0, d), 0.4f, 3);
      if (f.nilai < mn) mn = f.nilai; float e = fabsf(f.nilai - benar); if (t > 5 && e > galatMaks) galatMaks = e;
      if (waspada_t < 0 && f.nilai >= 2.5f) waspada_t = t; if (siaga_t < 0 && f.nilai >= 4.5f) siaga_t = t; if (awas_t < 0 && f.nilai >= 6.0f) awas_t = t;
      if (benarW < 0 && benar >= 2.5f) benarW = t; if (benarS < 0 && benar >= 4.5f) benarS = t; if (benarA < 0 && benar >= 6.0f) benarA = t; }
    printf("   galat maks %.2f cm | waspada %d (benar %d) siaga %d (benar %d) awas %d (benar %d) | dipakai %d bacaan\n", galatMaks, waspada_t, benarW, siaga_t, benarS, awas_t, benarA, dipakai);
    CEK("selama pengisian tinggi tersaring tidak pernah minus", mn >= 0.0f);
    CEK("galat tinggi tersaring <= 0,7 cm walau ada derau dan percikan", galatMaks <= 0.7f);
    CEK("WASPADA terdeteksi paling lambat 4 detik dari kenyataan", waspada_t >= 0 && waspada_t - benarW <= 4 && waspada_t - benarW >= -2);
    CEK("SIAGA terdeteksi paling lambat 4 detik dari kenyataan", siaga_t >= 0 && siaga_t - benarS <= 4 && siaga_t - benarS >= -2);
    CEK("AWAS terdeteksi paling lambat 4 detik dari kenyataan", awas_t >= 0 && awas_t - benarA <= 4 && awas_t - benarA >= -2); }

  printf("== Kecocokan kalibrasi dengan tangki ==\n");
  CEK("preset tinwall (dasar 200, AWAS 120, skala 20) masuk akal", kalibrasiMasukAkal(200, 20, 120, 7.5f, 2.0f, 40.0f));
  CEK("preset LAMA maket 22 cm (dasar 440, AWAS 160) DITOLAK untuk tinwall 7,5 cm", !kalibrasiMasukAkal(440, 20, 160, 7.5f, 2.0f, 40.0f));
  CEK("dasar terlalu kecil (sensor lebih dekat dari tinggi tangki + 2 cm) ditolak", !kalibrasiMasukAkal(150, 20, 100, 7.5f, 2.0f, 40.0f));
  CEK("skala/dasar nol atau minus ditolak", !kalibrasiMasukAkal(0, 20, 120, 7.5f, 2.0f, 40.0f) && !kalibrasiMasukAkal(200, 0, 120, 7.5f, 2.0f, 40.0f) && !kalibrasiMasukAkal(-5, 20, 120, 7.5f, 2.0f, 40.0f));

  printf("\n%d lulus, %d gagal\n", pass, fail);
  return fail == 0 ? 0 : 1;
}
