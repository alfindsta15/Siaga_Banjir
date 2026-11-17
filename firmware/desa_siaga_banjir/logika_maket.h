#pragma once
// ============================================================================
//  LOGIKA MURNI MAKET (tanpa Arduino) - konversi jarak sensor -> tinggi air yang AMAN
//  Tujuan: tinggi air TIDAK PERNAH minus dan tidak "berhalusinasi" karena pantulan/percikan.
//  Diuji di komputer: tools/uji_logika_maket.cpp  (npm run uji:maket)
// ============================================================================
#include <math.h>

struct GeomMaket {
  float d0;           // jarak sensor ke dasar tangki KOSONG (cm)
  float tinggi;       // tinggi dinding tangki (cm): air tidak mungkin lebih tinggi
  float margin;       // toleransi di luar jendela jarak yang masuk akal (cm)
  float minJarak;     // batas dekat HC-SR04 (cm), bacaan di bawah ini tidak dipercaya
  float zeroBand;     // tinggi di bawah ini dianggap 0 (cm): derau di tangki kosong
  float maxLonjakan;  // perubahan tinggi maksimum antar dua bacaan yang masuk akal (cm)
};

enum Vonis { V_OK = 0, V_JAUH = 1, V_DEKAT = 2, V_LONJAKAN = 3 };

struct FilterLevel {
  bool siap;      // sudah punya nilai awal?
  float nilai;    // tinggi tersaring (cm), selalu 0..tinggi
  int tolak;      // jumlah bacaan lonjakan yang ditolak beruntun
};

inline void resetFilter(FilterLevel& f) { f.siap = false; f.nilai = 0.0f; f.tolak = 0; }

// Jendela jarak yang mungkin: dari (dasar - tinggi tangki) sampai (dasar + margin).
// Di luar itu = sensor tidak menghadap tangki / tertutup / terganggu -> BUKAN "air minus".
inline Vonis jendela(const GeomMaket& g, float jarak) {
  float dekat = g.d0 - g.tinggi - g.margin;
  if (dekat < g.minJarak) dekat = g.minJarak;
  if (jarak > g.d0 + g.margin) return V_JAUH;
  if (jarak < dekat) return V_DEKAT;
  return V_OK;
}

// Tinggi dari jarak, dipotong 0..tinggi dan dengan zona nol.
inline float levelMentah(const GeomMaket& g, float k, float l0, float jarak) {
  float lv = l0 + k * (g.d0 - jarak);
  if (lv < g.zeroBand) lv = 0.0f;
  if (lv > g.tinggi) lv = g.tinggi;
  return lv;
}

// Satu langkah penyaring. Lonjakan mendadak (percikan, pantulan ganda) ditolak sampai 'maxTolak'
// kali beruntun; bila bacaan baru bertahan, dianggap perubahan nyata dan diikuti.
// Penghalusan eksponensial (alpha) meredam riak air.
inline Vonis langkah(FilterLevel& f, const GeomMaket& g, float lv, float alpha, int maxTolak) {
  if (!f.siap) { f.siap = true; f.nilai = lv; f.tolak = 0; return V_OK; }
  float d = lv - f.nilai; if (d < 0) d = -d;
  if (d > g.maxLonjakan && f.tolak < maxTolak) { f.tolak++; return V_LONJAKAN; }
  f.tolak = 0;
  f.nilai += alpha * (lv - f.nilai);
  if (f.nilai < g.zeroBand) f.nilai = 0.0f;
  if (f.nilai > g.tinggi) f.nilai = g.tinggi;
  return V_OK;
}

// Apakah kalibrasi (dari server/EEPROM) cocok dengan geometri tangki? Bila tidak, ditolak.
//  base/skala = jarak dasar (cm maket) harus >= tinggi tangki + jarak minimum sensor;
//  ambang AWAS tidak boleh lebih tinggi dari tangki.
inline bool kalibrasiMasukAkal(float base, float skala, float awasNyata, float tinggiTangki, float minJarak, float d0Maks) {
  if (!(skala > 0.0f) || !(base > 0.0f)) return false;
  float d0 = base / skala;
  return d0 >= tinggiTangki + minJarak && d0 <= d0Maks && awasNyata > 0.0f && awasNyata <= tinggiTangki * skala + 0.5f;
}
