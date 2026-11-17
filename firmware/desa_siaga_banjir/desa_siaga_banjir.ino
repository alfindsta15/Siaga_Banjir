/*
  DESA SIAGA BANJIR - MAKET DEMO
  ESP8266 NodeMCU ESP-12E

  VERSI 3.1 - GANTI WI-FI TANPA COMPILE ULANG
  - Wi-Fi tersimpan di memori alat (EEPROM). konfigurasi.h hanya nilai AWAL (diisi sekali).
  - Ganti Wi-Fi: (a) dashboard > Koneksi > Wi-Fi alat (cari, pilih, sandi) saat alat online, atau
    (b) hotspot setup \"SIAGA-SETUP\" (muncul sendiri bila Wi-Fi putus 40 detik, atau kirim 'w' di Serial) lalu buka 192.168.4.1.
  - Wi-Fi baru baru DISIMPAN bila alat benar-benar tersambung (dari dashboard: sampai server membalas lewat broker).
    Bila gagal dalam 45 detik, alat kembali ke Wi-Fi lama otomatis. Serial 'x' = hapus Wi-Fi tersimpan.
  (Sebelumnya) VERSI 3.0 - ONLINE LEWAT MQTT + ISI SAMPAI TINGGI TARGET
  - PAKAI_MQTT 1 (konfigurasi.h): alat hanya perlu menjangkau broker MQTT (mis. HiveMQ Cloud), tanpa IP publik/port forwarding.
    PAKAI_MQTT 0: cara lama, HTTP langsung ke server. Isi data dan balasan server SAMA di kedua jalur.
  - Perintah dari dashboard: "isi sampai X cm" (atau level WASPADA/SIAGA/AWAS). Pompa berhenti SENDIRI di target.
    Tidak ada pompa buang: wadah dikosongkan MANUAL setelah demo, dan pompa tidak akan mengisi lagi tanpa perintah baru.
  - Koneksi/perintah putus -> pompa dimatikan (fail-safe), juga SEBELUM mencoba menyambung ulang ke broker.
  (Sebelumnya) VERSI 2.9 - KALIBRASI TINWALL 17 x 11 x 7,5 cm
  - Tinggi air tidak pernah minus; bacaan mustahil ditolak (bukan dijadikan "air minus")
  - Penyaring lonjakan + penghalusan, zona nol, jendela jarak (lihat logika_maket.h)
  - Perintah Serial 'k' (tangki KOSONG): kalibrasi jarak dasar otomatis; 'p': uji relay 1,5 detik
  - Pompa lewat relay/MOSFET: atur RELAY_AKTIF_LOW (lihat bagian PIN POMPA)
  - Pompa berhenti bila air tidak naik (pompa kering / sensor tertutup)
  - Kredensial Wi-Fi/server/kunci dipindah ke konfigurasi.h (jangan dibagikan)

  PIN:
  D1 = TRIG
  D2 = ECHO (pembagi tegangan 1k/2k)
  D5 = LED
  D6 = BUZZER I/O (VCC modul WAJIB ke 3V3, GND ke GND)
  D7 = MOSFET POMPA

  STATUS:
  NORMAL  = LED OFF, BUZZER OFF
  WASPADA = LED berkedip 1000 ms, BUZZER OFF
  SIAGA   = LED + BUZZER 1800 Hz
  AWAS    = LED ON berkedip cepat + BUZZER 2500 Hz cepat
*/

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <EEPROM.h>
#include "konfigurasi.h"      // WIFI_SSID, WIFI_PASS, DEVICE_KEY, DEVICE_ID, PAKAI_MQTT, MQTT_*, SERVER_URL
#include "logika_maket.h"
#ifndef PAKAI_MQTT
#define PAKAI_MQTT 0          // konfigurasi.h lama (tanpa MQTT): tetap pakai HTTP
#endif
#include <ESP8266WebServer.h>   // portal setup Wi-Fi (bawaan board ESP8266)
#ifndef SETUP_AP_PASS
#define SETUP_AP_PASS "siaga-setup"   // sandi hotspot setup (minimal 8 karakter); ubah di konfigurasi.h
#endif
#if PAKAI_MQTT
#include <PubSubClient.h>     // Arduino Library Manager: "PubSubClient" oleh Nick O'Leary (versi 2.8 atau lebih baru)
#endif

const char* FW_VERSION = "3.1-wifi";

// =====================================================
// 2. KALIBRASI TINWALL
//    Wadah: tinggi 7,5 cm, panjang 17 cm, lebar 11 cm.
//    Sensor HC-SR04 di atas wadah, +-10 cm dari DASAR.
//    Ukur jarak dasar yang tepat: tangki KOSONG lalu kirim 'k' di Serial Monitor
//    (atau tombol "Tangki kosong" di dashboard > Kalibrasi).
// =====================================================

const float D0_CM = 10.0;        // jarak sensor ke dasar tangki kosong (cm)
const float L0_CM = 0.0;
const float K_CAL = 1.0;

const float TANK_CM = 7.5;       // tinggi dinding tinwall (cm)
const float TINWALL_P_CM = 17.0; // panjang dalam (cm)
const float TINWALL_L_CM = 11.0; // lebar dalam (cm)
const float SKALA = 20.0;        // 1 cm maket = 20 cm sungai nyata

const float WASPADA_CM = 2.5;    // cm maket (= 50 cm nyata), ~468 ml
const float SIAGA_CM = 4.5;      // cm maket (= 90 cm nyata),  ~842 ml
const float AWAS_CM = 6.0;       // cm maket (= 120 cm nyata), ~1122 ml

const float HIST_CM = 0.4;       // histeresis turun level (cm maket)

// Penyaring pembacaan (lihat logika_maket.h)
const float JARAK_MIN_CM = 2.0;      // batas dekat HC-SR04
const float D0_MAKS_CM = 40.0;       // batas atas jarak dasar yang masuk akal
const float MARGIN_CM = 1.0;         // toleransi jendela jarak
const float ZERO_BAND_CM = 0.25;     // di bawah ini = 0 (derau tangki kosong)
const float MAX_LONJAKAN_CM = 1.0;   // loncatan maksimum antar bacaan (1 dtk)
const float EMA_ALPHA = 0.4;         // penghalusan (0..1, makin kecil makin halus)
const int MAX_TOLAK = 3;             // bacaan lonjakan yang ditolak beruntun sebelum diikuti

// =====================================================
// 3. PENGAMAN POMPA
// =====================================================

const float PUMP_MAX_CM = 6.8;                    // berhenti sebelum meluap (bibir tinwall 7,5 cm)
const unsigned long PUMP_MAX_MS = 120000UL;       // batas waktu satu kali jalan
const unsigned long PUMP_NO_RISE_MS = 25000UL;    // pompa nyala selama ini ...
const float PUMP_NO_RISE_CM = 0.25;               // ... tetapi air naik kurang dari ini = pompa kering/sensor tertutup
const bool DEMO_MODE = true;
// Pompa berhenti sedikit SEBELUM target (cm maket) karena air masih mengalir dari selang dan bacaan tersaring tertinggal ~1 detik.
// Bila air selalu berhenti LEBIH TINGGI dari target, isi 0.05 sampai 0.15. Hanya untuk target "cm", bukan target level.
const float PUMP_ANTISIPASI_CM = 0.0;

// =====================================================
// 4. PIN
// =====================================================

const uint8_t PIN_TRIG = D1;
const uint8_t PIN_ECHO = D2;
const uint8_t PIN_LED = D5;
const uint8_t PIN_BUZZER = D6;
const uint8_t PIN_PUMP = D7;

// Jenis penggerak pompa:
//  false = MOSFET atau relay AKTIF-HIGH (pin HIGH = pompa nyala)   <- wiring MOSFET sebelumnya
//  true  = modul relay AKTIF-LOW (pin LOW = relay nyala), yang paling umum untuk modul relay 1 kanal
// UJI SEBELUM MEMASANG SELANG/AIR: saat ESP baru menyala relay harus DIAM (tidak klik, lampu relay mati).
// Bila relay justru nyala saat seharusnya mati, ubah nilai ini. Kirim 'p' di Serial untuk uji relay 1,5 detik.
const bool RELAY_AKTIF_LOW = false;
inline void tulisPompa(bool on) { digitalWrite(PIN_PUMP, (on != RELAY_AKTIF_LOW) ? HIGH : LOW); }

// =====================================================
// 5. KALIBRASI EEPROM
// =====================================================

struct Cal {
  uint32_t magic;
  float base;
  float l0;
  float k;
  float skala;
  float w;
  float s;
  float a;
  float laju;
} cal;

const uint32_t CAL_MAGIC = 0x53494150;   // diubah agar kalibrasi lama (tangki lain) tidak terbawa

void defaultCal() {
  cal = {
    CAL_MAGIC,
    D0_CM * SKALA,
    L0_CM,
    K_CAL,
    SKALA,
    WASPADA_CM * SKALA,
    SIAGA_CM * SKALA,
    AWAS_CM * SKALA,
    100000.0f
  };
}

void loadCal() {
  EEPROM.begin(512);   // Cal di alamat 0, Wi-Fi tersimpan di alamat NET_OFS (64)
  EEPROM.get(0, cal);

  bool valid =
    cal.magic == CAL_MAGIC &&
    cal.base > 0.0f &&
    cal.l0 >= 0.0f &&
    cal.k > 0.0f &&
    cal.skala > 0.0f &&
    cal.w < cal.s &&
    cal.s < cal.a &&
    kalibrasiMasukAkal(cal.base, cal.skala, cal.a, TANK_CM, JARAK_MIN_CM, D0_MAKS_CM);

  if (!valid) {
    defaultCal();
  }
}

void saveCal() {
  Cal old;
  EEPROM.get(0, old);
  if (memcmp(&old, &cal, sizeof(Cal)) != 0) {
    EEPROM.put(0, cal);
    EEPROM.commit();
  }
}

float thD0() { return cal.base / cal.skala; }
float thW()  { return cal.w / cal.skala; }
float thS()  { return cal.s / cal.skala; }
float thA()  { return cal.a / cal.skala; }

GeomMaket geom() {
  GeomMaket g;
  g.d0 = thD0();
  g.tinggi = TANK_CM;
  g.margin = MARGIN_CM;
  g.minJarak = JARAK_MIN_CM;
  g.zeroBand = ZERO_BAND_CM;
  g.maxLonjakan = MAX_LONJAKAN_CM;
  return g;
}

// =====================================================
// 5b. WI-FI TERSIMPAN (EEPROM). konfigurasi.h hanya nilai awal; yang tersimpan di sini didahulukan.
// =====================================================

struct WifiSimpan {
  uint32_t magic;
  char ssid[33];   char pass[65];     // Wi-Fi utama (dipakai lebih dulu)
  char ssidB[33];  char passB[65];    // cadangan: Wi-Fi sebelumnya
};
WifiSimpan wcfg;
const int NET_OFS = 64;
const uint32_t NET_MAGIC = 0x4E455431;

struct TrialWifi {                    // percobaan Wi-Fi baru: BELUM disimpan sampai berhasil
  bool aktif;
  bool remote;                        // true = dari dashboard (harus sampai server membalas), false = dari portal
  unsigned long t0;
  unsigned long tok;
  WifiSimpan prev;
};
TrialWifi trial;
const unsigned long TRIAL_MS = 45000UL;
int wifiRes = 0;                      // 0 belum ada, 1 berhasil, 2 gagal (dilaporkan ke dashboard)
unsigned long wifiResTok = 0;
unsigned long lastScanTok = 0, lastSetTok = 0, scanTokNow = 0;
bool scanPending = false;
unsigned long lastServerRx = 0;       // kapan terakhir menerima balasan server (HTTP atau MQTT)

ESP8266WebServer portal(80);
bool portalOn = false, portalManual = false;
unsigned long portalSince = 0, wifiDownSince = 0, wifiUpSince = 0;
int wifiIdx = 0;

void salin(char* dst, const char* src, size_t n) {
  strncpy(dst, src, n - 1);
  dst[n - 1] = 0;
}

void loadNet() {
  EEPROM.get(NET_OFS, wcfg);
  if (wcfg.magic != NET_MAGIC) {
    memset(&wcfg, 0, sizeof(wcfg));
    wcfg.magic = NET_MAGIC;
  }
  wcfg.ssid[32] = 0; wcfg.pass[64] = 0; wcfg.ssidB[32] = 0; wcfg.passB[64] = 0;
}

void saveNet() {
  EEPROM.put(NET_OFS, wcfg);
  EEPROM.commit();
}

const char* wifiSsidAktif() { return wcfg.ssid[0] ? wcfg.ssid : WIFI_SSID; }
const char* wifiPassAktif() { return wcfg.ssid[0] ? wcfg.pass : WIFI_PASS; }

// Urutan percobaan: Wi-Fi aktif, cadangan, lalu bawaan konfigurasi.h (bila belum termasuk)
int wifiDaftar(const char** ss, const char** pp) {
  int n = 0;
  ss[n] = wifiSsidAktif(); pp[n] = wifiPassAktif(); n++;
  if (wcfg.ssidB[0] && strcmp(wcfg.ssidB, ss[0]) != 0) { ss[n] = wcfg.ssidB; pp[n] = wcfg.passB; n++; }
  bool ada = false;
  for (int i = 0; i < n; i++) if (strcmp(ss[i], WIFI_SSID) == 0) ada = true;
  if (!ada) { ss[n] = WIFI_SSID; pp[n] = WIFI_PASS; n++; }
  return n;
}

// =====================================================
// 6. STATUS SISTEM
// =====================================================

enum Status { NORMAL = 0, WASPADA = 1, SIAGA = 2, AWAS = 3 };
const char* STATUS_TXT[] = { "NORMAL", "WASPADA", "SIAGA", "AWAS" };
Status status = NORMAL;

// =====================================================
// 7. VARIABEL SENSOR
// =====================================================

float distanceCm = 0.0f;
float level = 0.0f;   // Tinggi tersaring (cm maket), selalu 0..TANK_CM
FilterLevel filt;     // penyaring lonjakan + penghalusan (logika_maket.h)
bool cfgDitolak = false;   // konfigurasi server ditolak karena tidak cocok dengan tinwall
bool calPush = false;      // beri tahu server bahwa dasar baru baru saja dikalibrasi di alat

bool sensorOk = false;
bool sensorFault = false;
int sensorErrCount = 0;

// =====================================================
// 8. VARIABEL POMPA
// =====================================================

enum PumpMode { PUMP_OFF = 0, PUMP_MANUAL = 1, PUMP_TARGET = 2 };
PumpMode pumpMode = PUMP_OFF;
int targetLvl = 0;
float targetFieldM = 0.0f;
float targetMaketCm = 0.0f;
bool targetDone = false;
String lastCmdSig = "";

bool pumpRunning = false;
bool pumpLockout = false;
unsigned long pumpStart = 0;
float pumpLevel0 = 0.0f;   // tinggi saat pompa dinyalakan (untuk deteksi pompa kering)

// =====================================================
// 9. VARIABEL WAKTU
// =====================================================

unsigned long lastMeasure = 0;
unsigned long lastSend = 0;
unsigned long lastHist = 0;
unsigned long lastWifiTry = 0;
unsigned long lastBeep = 0;

bool beepState = false;
bool sendNow = false;
bool buzzerPlaying = false; // Penanda fungsi buzzer

// =====================================================
// 10. RIWAYAT SENSOR
// =====================================================

float hist[12];
int histIdx = 0;
int histCount = 0;
float rateCm = 0.0f;
int failCount = 0;

// =====================================================
// 11. VARIABEL ALARM FADING
// =====================================================

bool alarmFadeActive = false;
unsigned long alarmFadeStart = 0;
const unsigned long ALARM_FADE_DURATION = 1500UL;

Status fadeFromStatus = NORMAL;
Status fadeToStatus = NORMAL;

// =====================================================
// 12. KONEKSI HTTP
// =====================================================

WiFiClientSecure secureClient;
WiFiClient plainClient;

// =====================================================
// 13. BUZZER (LOW-LEVEL TRIGGER SAFE)
// =====================================================

void startBuzzer(unsigned int freq) {
  tone(PIN_BUZZER, freq);
  buzzerPlaying = true;
}

void silenceBuzzer() {
  if (buzzerPlaying) {
    noTone(PIN_BUZZER);
    buzzerPlaying = false;
  }
  digitalWrite(PIN_BUZZER, HIGH);  // Tahan HIGH agar modul mati total
}

// =====================================================
// 14. SENSOR HC-SR04
// =====================================================

float readDistanceCm() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(5);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);

  unsigned long us = pulseIn(PIN_ECHO, HIGH, 35000UL);
  if (us == 0) return -1.0f;

  float cm = (float)us * 0.0343f / 2.0f;
  if (cm < 2.0f || cm > 400.0f) return -1.0f;

  return cm;
}

// =====================================================
// 15. MEDIAN SENSOR
// =====================================================

float readMedianCm() {
  const int N = 5;
  float v[N];
  int n = 0;

  for (int i = 0; i < N; i++) {
    float d = readDistanceCm();
    if (d >= 2.0f && d <= 400.0f) {
      v[n++] = d;
    }
    delay(45);
    yield();
  }

  if (n < 3) return -1.0f;

  for (int i = 1; i < n; i++) {
    float key = v[i];
    int j = i - 1;
    while (j >= 0 && v[j] > key) {
      v[j + 1] = v[j];
      j--;
    }
    v[j + 1] = key;
  }

  return v[n / 2];
}

// =====================================================
// 16. UPDATE STATUS
// =====================================================

void updateStatus(float lv) {
  Status old = status;
  float T[3] = { thW(), thS(), thA() };

  int up = lv >= T[2] ? 3 : lv >= T[1] ? 2 : lv >= T[0] ? 1 : 0;
  float ratePerHour = rateCm * cal.skala * 60.0f;

  if (histCount == 12 && ratePerHour >= cal.laju && lv * cal.skala >= cal.w) {
    up = 3;
  }

  int keep = 0;
  for (int L = 3; L >= 1; L--) {
    if (lv >= T[L - 1] - HIST_CM) {
      keep = L;
      break;
    }
  }

  if (up > (int)status) {
    status = (Status)up;
  } else if (keep < (int)status) {
    status = (Status)keep;
  }

  if (status != old) {
    sendNow = true;
    Serial.printf("Status berubah: %s -> %s\n", STATUS_TXT[old], STATUS_TXT[status]);

    if ((int)status < (int)old) {
      // Menurun: fading jika status sebelumnya SIAGA atau AWAS
      if (old >= SIAGA) {
        fadeFromStatus = old;
        fadeToStatus = status;
        alarmFadeActive = true;
        alarmFadeStart = millis();
        beepState = false;
      } else {
        alarmFadeActive = false;
        beepState = false;
        silenceBuzzer();
      }
    } else {
      // Meningkat
      alarmFadeActive = false;
      beepState = false;
      silenceBuzzer();
      lastBeep = millis();
    }
  }
}

// =====================================================
// 17. ALARM FADING & LED
// =====================================================

void handleAlarm() {
  unsigned long n = millis();

  // -------------------------------------------------
  // MODE FADING
  // -------------------------------------------------
  if (alarmFadeActive) {
    unsigned long elapsed = n - alarmFadeStart;
    float progress = (float)elapsed / ALARM_FADE_DURATION;

    if (progress >= 1.0f) {
      alarmFadeActive = false;
      beepState = false;
      silenceBuzzer();
      analogWrite(PIN_LED, 0);
      digitalWrite(PIN_LED, LOW);
      lastBeep = n;
      return;
    }

    float intensity = 1.0f - progress;
    int brightness = (int)(1023.0f * intensity);
    analogWrite(PIN_LED, brightness);

    unsigned long cycle = 150UL;
    unsigned long onDuration = (unsigned long)(100.0f * intensity);
    unsigned long position = elapsed % cycle;

    if (position < onDuration && onDuration > 0) {
      if (!beepState) {
        beepState = true;
        startBuzzer(fadeFromStatus == AWAS ? 2500 : 1800);
      }
    } else {
      if (beepState) {
        beepState = false;
        silenceBuzzer();
      }
    }
    return;
  }

  // -------------------------------------------------
  // NORMAL
  // -------------------------------------------------
  if (status == NORMAL) {
    beepState = false;
    analogWrite(PIN_LED, 0);
    digitalWrite(PIN_LED, LOW);
    silenceBuzzer();
    lastBeep = n;
  }
  // -------------------------------------------------
  // WASPADA
  // -------------------------------------------------
  else if (status == WASPADA) {
    silenceBuzzer();
    if (n - lastBeep >= 1000) {
      lastBeep = n;
      beepState = !beepState;
      digitalWrite(PIN_LED, beepState);
    }
  }
  // -------------------------------------------------
  // SIAGA
  // -------------------------------------------------
  else if (status == SIAGA) {
    if (n - lastBeep >= 400) {
      lastBeep = n;
      beepState = !beepState;
      digitalWrite(PIN_LED, beepState);
      if (beepState) {
        startBuzzer(1800);
      } else {
        silenceBuzzer();
      }
    }
  }
  // -------------------------------------------------
  // AWAS
  // -------------------------------------------------
  else if (status == AWAS) {
    // LED ikut berkedip cepat seirama dengan buzzer
    if (n - lastBeep >= 150) {
      lastBeep = n;
      beepState = !beepState;
      digitalWrite(PIN_LED, beepState);
      if (beepState) {
        startBuzzer(2500);
      } else {
        silenceBuzzer();
      }
    }
  }
}

// =====================================================
// 18. POMPA
// =====================================================

void setPump(bool on) {
  if (pumpRunning == on) return;
  pumpRunning = on;
  tulisPompa(on);
  if (on) { pumpStart = millis(); pumpLevel0 = level; }
  sendNow = true;
  Serial.println(on ? "Pompa: ON" : "Pompa: OFF");
}

float computeTargetMaketCm() {
  if (targetFieldM > 0.0f) {
    float t = (targetFieldM * 100.0f) / cal.skala - PUMP_ANTISIPASI_CM;
    return t < 0.1f ? 0.1f : t;
  }
  if (targetLvl == 1) return thW() + 0.2f;
  if (targetLvl == 2) return thS() + 0.2f;
  if (targetLvl == 3) return thA() + 0.2f;
  return 0.0f;
}

void handlePump() {
  if (pumpMode == PUMP_OFF) {
    pumpLockout = false;
    targetDone = false;
    setPump(false);
    return;
  }

  // Gunakan level yang dipotong untuk pengaman fisik
  float safeLevel = level < 0.0f ? 0.0f : (level > TANK_CM ? TANK_CM : level);
  bool safe = !pumpLockout && sensorOk && !sensorFault && (safeLevel < PUMP_MAX_CM);

  if (!safe) {
    if (pumpRunning) {
      setPump(false);
      pumpLockout = true;
      Serial.println(F("Pompa berhenti: batas aman tangki / sensor tercapai"));
    }
    return;
  }

  if (pumpRunning && millis() - pumpStart >= PUMP_MAX_MS) {
    setPump(false);
    pumpLockout = true;
    Serial.println(F("Pompa berhenti: batas waktu maksimal tercapai"));
    return;
  }

  // Pompa kering / sensor tertutup: pompa nyala cukup lama tetapi air tidak naik
  if (pumpRunning && millis() - pumpStart >= PUMP_NO_RISE_MS && (safeLevel - pumpLevel0) < PUMP_NO_RISE_CM) {
    setPump(false);
    pumpLockout = true;
    Serial.println(F("Pompa berhenti: air tidak naik (cek air di penampung, selang, atau sensor tertutup)"));
    return;
  }

  if (pumpMode == PUMP_MANUAL) {
    setPump(true);
  } else if (pumpMode == PUMP_TARGET) {
    targetMaketCm = computeTargetMaketCm();
    if (targetMaketCm <= 0.0f || targetDone) {
      setPump(false);
      return;
    }

    if (safeLevel < targetMaketCm) {
      setPump(true);
    } else {
      setPump(false);
      targetDone = true;
      Serial.printf("Target tercapai: %.1f cm\n", safeLevel);
    }
  }
}

// =====================================================
// 18b. KALIBRASI DASAR (tangki KOSONG) LEWAT SERIAL: kirim 'k'
// =====================================================

void kalibrasiDasarSerial() {
  if (pumpRunning) {
    Serial.println(F("Kalibrasi dibatalkan: matikan pompa dulu."));
    return;
  }
  Serial.println(F("Kalibrasi dasar: pastikan tangki KOSONG dan sensor tidak bergeser..."));
  float v[3];
  int n = 0;
  for (int i = 0; i < 3; i++) {
    float d = readMedianCm();
    if (d > 0.0f) v[n++] = d;
    delay(100);
    yield();
  }
  if (n < 3) {
    Serial.println(F("Gagal: sensor tidak terbaca stabil. Periksa kabel/posisi."));
    return;
  }
  for (int i = 1; i < 3; i++) {   // urutkan 3 nilai
    float key = v[i];
    int j = i - 1;
    while (j >= 0 && v[j] > key) { v[j + 1] = v[j]; j--; }
    v[j + 1] = key;
  }
  float med = v[1];
  float spread = v[2] - v[0];
  if (spread > 0.6f) {
    Serial.printf("Gagal: bacaan belum stabil (selisih %.2f cm). Tunggu air tenang, coba lagi.\n", spread);
    return;
  }
  if (med < TANK_CM + JARAK_MIN_CM || med > D0_MAKS_CM) {
    Serial.printf("Gagal: %.2f cm tidak masuk akal (harus %.1f - %.1f cm). Cek posisi sensor.\n",
                  med, TANK_CM + JARAK_MIN_CM, D0_MAKS_CM);
    return;
  }
  cal.base = med * cal.skala;
  saveCal();
  resetFilter(filt);
  calPush = true;      // kabari server agar memakai dasar yang sama
  sendNow = true;
  Serial.printf("Jarak dasar disimpan: %.2f cm (selisih %.2f cm). Server akan ikut menyesuaikan.\n", med, spread);
}

// =====================================================
// 18c. UJI RELAY LEWAT SERIAL: kirim 'p' (tanpa air/selang)
// =====================================================

void ujiRelaySerial() {
  if (pumpRunning) {
    Serial.println(F("Uji relay dibatalkan: pompa sedang berjalan."));
    return;
  }
  Serial.println(F("Uji relay: ON selama 1,5 detik (harus terdengar klik dan lampu relay menyala)..."));
  tulisPompa(true);
  unsigned long t0 = millis();
  while (millis() - t0 < 1500UL) { delay(10); yield(); }
  tulisPompa(false);
  Serial.println(F("Uji relay selesai: OFF. Bila relay malah menyala saat OFF, ubah RELAY_AKTIF_LOW."));
}

// =====================================================
// 19. WIFI
// =====================================================

bool cobaWifi(const char* ssid, const char* pass, unsigned long waitMs) {
  WiFi.begin(ssid, pass);
  unsigned long t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < waitMs) {
    delay(250);
    Serial.print(".");
    yield();
  }
  return WiFi.status() == WL_CONNECTED;
}

// Dipanggil saat menyala: coba Wi-Fi aktif, lalu cadangan, lalu bawaan konfigurasi.h
void connectWifi(unsigned long waitMs) {
  WiFi.persistent(false);   // jangan tulis kredensial ke flash SDK; penyimpanan diatur sendiri (wcfg)
  WiFi.mode(WIFI_STA);
  const char* ss[3];
  const char* pp[3];
  int n = wifiDaftar(ss, pp);
  for (int i = 0; i < n; i++) {
    Serial.printf("Wi-Fi: mencoba \"%s\" ", ss[i]);
    if (cobaWifi(ss[i], pp[i], waitMs)) {
      wifiIdx = i;
      Serial.printf("\nWi-Fi tersambung ke \"%s\" (%s)\n", ss[i], wcfg.ssid[0] ? "tersimpan di alat" : "dari konfigurasi.h");
      return;
    }
    WiFi.disconnect();
    Serial.println(" gagal");
  }
  Serial.println(F("Wi-Fi gagal. Hotspot setup \"SIAGA-SETUP\" akan dibuka bila tetap putus 40 detik (atau kirim 'w')."));
}

// =====================================================
// 20. KONFIGURASI SERVER
// =====================================================

void applyServerCfg(JsonObject c) {
  Cal n = cal;
  n.base = c["base"] | cal.base;
  n.l0 = c["l0"] | cal.l0;
  n.k = c["k"] | cal.k;
  n.skala = c["skala"] | cal.skala;
  n.w = c["waspada"] | cal.w;
  n.s = c["siaga"] | cal.s;
  n.a = c["awas"] | cal.a;
  n.laju = c["laju"] | cal.laju;

  bool valid =
    n.base > 0.0f &&
    n.l0 >= 0.0f &&
    n.k > 0.0f &&
    n.skala > 0.0f &&
    n.w < n.s &&
    n.s < n.a;

  bool masukAkal = kalibrasiMasukAkal(n.base, n.skala, n.a, TANK_CM, JARAK_MIN_CM, D0_MAKS_CM);

  if (valid && !masukAkal) {
    if (!cfgDitolak) {
      Serial.println(F("Konfigurasi server DITOLAK: dasar/ambang AWAS tidak cocok dengan tinwall 7,5 cm."));
      Serial.println(F("Di dashboard > Kalibrasi klik preset 'Maket tinwall' lalu Simpan."));
    }
    cfgDitolak = true;
  } else if (valid) {
    cfgDitolak = false;
    if (fabsf(n.base - cal.base) > 0.01f) resetFilter(filt);
    bool berubah = memcmp(&n, &cal, sizeof(Cal)) != 0;
    cal = n;
    if (berubah) saveCal();   // tulis flash hanya bila ada perubahan (hemat umur flash)
  }
}

// =====================================================
// 21. PERINTAH POMPA SERVER
// =====================================================

void parsePumpCommand(JsonDocument& r) {
  const char* modeStr = r["pump_mode"] | "";
  int rawPump = r["pump"] | 0;
  int newTargetLvl = r["target_lvl"] | 0;
  float newTargetM = r["target_m"] | 0.0f;

  PumpMode nextMode = PUMP_OFF;
  if (strcmp(modeStr, "TARGET") == 0) {
    nextMode = PUMP_TARGET;
  } else if (strcmp(modeStr, "MANUAL") == 0) {
    nextMode = PUMP_MANUAL;
  } else if (strcmp(modeStr, "OFF") == 0) {
    nextMode = PUMP_OFF;
  } else {
    nextMode = (rawPump == 1) ? PUMP_MANUAL : PUMP_OFF;
  }

  String cmdSig = String((int)nextMode) + ":" + String(newTargetLvl) + ":" + String(newTargetM, 2);

  if (cmdSig != lastCmdSig) {
    lastCmdSig = cmdSig;
    pumpMode = nextMode;
    targetLvl = newTargetLvl;
    targetFieldM = newTargetM;
    targetDone = false;
    pumpLockout = false;

    Serial.printf("Perintah pompa baru -> mode=%d target_lvl=%d target_m=%.2f\n",
                  (int)pumpMode, targetLvl, targetFieldM);
  }
}

// =====================================================
// 22. KIRIM TELEMETRI (HTTP atau MQTT: isi data dan balasan server sama)
// =====================================================

// Matikan pompa dan batalkan perintah. Perintah baru dari server tetap diterima setelah koneksi pulih.
void failSafePompa(const char* alasan) {
  if (pumpMode == PUMP_OFF) return;
  pumpMode = PUMP_OFF;
  lastCmdSig = "0:0:0.00";
  setPump(false);
  Serial.printf("Fail-safe: %s\n", alasan);
}

// Balasan server (HTTP: isi respons, MQTT: pesan di .../cmd): perintah pompa + kalibrasi
void terimaBalasan(JsonDocument& r) {
  lastServerRx = millis();
  parsePumpCommand(r);
  parseWifiCommand(r);
  JsonObject c = r["cfg"];
  if (!c.isNull()) {
    applyServerCfg(c);
  }
  failCount = 0;
}

void bangunPayload(String& payload, bool denganKunci) {
  bool sensorGood = sensorOk && !sensorFault;

  // Ambil nilai yang dipotong untuk UI
  float safeLevel = level < 0.0f ? 0.0f : (level > TANK_CM ? TANK_CM : level);
  float tinggiNyataCm = safeLevel * cal.skala;
  float tinggiNyataM = tinggiNyataCm / 100.0f;

  JsonDocument d;
  d["id"] = DEVICE_ID;
  d["rssi"] = WiFi.RSSI();
  d["up"] = millis() / 1000UL;
  d["fw"] = FW_VERSION;
  d["pump"] = pumpRunning ? 1 : 0;
  d["pump_done"] = targetDone ? 1 : 0;
  if (pumpLockout) d["pump_lock"] = 1;   // pompa dihentikan pengaman alat (server mencatat alasannya)
  d["lvl"] = (int)status;
  d["status_txt"] = STATUS_TXT[status];
  d["tinggi_maket_cm"] = round(safeLevel * 10.0f) / 10.0f;
  d["tinggi_nyata_cm"] = round(tinggiNyataCm * 10.0f) / 10.0f;
  d["tinggi_nyata_m"] = round(tinggiNyataM * 100.0f) / 100.0f;
  d["rise"] = rateCm;

  d["base"] = cal.base;                 // server memeriksa kesamaan dasar agar tidak salah hitung
  if (cfgDitolak) d["cfg_rej"] = 1;
  if (calPush) { d["cal"] = 1; calPush = false; }

  if (sensorGood) {
    // dist = jarak NYATA yang setara dengan tinggi TERSARING (bukan bacaan mentah),
    // sehingga server tidak pernah menerima derau/lonjakan sensor.
    float distNyata = (thD0() - (level - cal.l0) / cal.k) * cal.skala;
    d["dist"] = round(distNyata * 10.0f) / 10.0f;
    d["dist_raw"] = round(distanceCm * cal.skala * 10.0f) / 10.0f;
  } else {
    d["err"] = 1;
  }
  // Info untuk kartu "Pengaturan tersimpan" di dashboard
  d["via"] = PAKAI_MQTT ? "mqtt" : "http";
  if (WiFi.status() == WL_CONNECTED) d["ssid"] = WiFi.SSID();
  d["ssid_b"] = wcfg.ssidB;
  d["wsrc"] = wcfg.ssid[0] ? "alat" : "konfigurasi.h";
#if PAKAI_MQTT
  d["mqh"] = MQTT_HOST;
#else
  d["mqh"] = SERVER_URL;
#endif
  if (wifiResTok) {                       // hasil perintah ganti Wi-Fi dari dashboard
    d["wifi_tok"] = wifiResTok;
    d["wifi_res"] = wifiRes == 1 ? "ok" : "gagal";
  }
  if (denganKunci) d["key"] = DEVICE_KEY;   // MQTT: kunci alat ikut di isi pesan (HTTP: lewat header X-Device-Key)

  serializeJson(d, payload);
}

bool kirimHttpKe(const String& payload, const char* path, bool baca) {
  String url = String(SERVER_URL) + path;
  bool https = strncmp(SERVER_URL, "https", 5) == 0;

  HTTPClient http;
  http.setTimeout(5000);

  bool begun = https ? http.begin(secureClient, url) : http.begin(plainClient, url);
  if (!begun) {
    failCount++;
    return false;
  }

  http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", DEVICE_KEY);

  int code = http.POST(payload);
  bool ok = false;

  if (code == 200 && !baca) {
    ok = true;
  } else if (code == 200) {
    JsonDocument r;
    if (!deserializeJson(r, http.getString())) {
      terimaBalasan(r);
      ok = true;
    } else {
      failCount++;
    }
  } else {
    failCount++;
    Serial.printf("Kirim gagal, kode: %d\n", code);
  }

  http.end();
  return ok;
}

bool kirimHttp(const String& payload) {
  return kirimHttpKe(payload, "/api/device/telemetry", true);
}

#if PAKAI_MQTT
// ---------------- MQTT ----------------
// Topik: <MQTT_PREFIX>/<DEVICE_ID>/telemetry (alat -> server), /cmd (server -> alat), /status ("online"/"offline")
PubSubClient mqtt;
String tTele, tCmd, tStatus;
unsigned long lastMqttTry = 0;
unsigned long lastCmdRx = 0;                       // kapan terakhir menerima perintah/balasan server
const unsigned long CMD_TIMEOUT_MS = 6000UL;       // pompa menyala tetapi 6 detik tanpa balasan server -> pompa dimatikan
const unsigned long MQTT_RETRY_MS = 5000UL;

void onMqtt(char* topic, byte* payload, unsigned int len) {
  static char rb[700];
  if (len == 0 || len >= sizeof(rb)) return;
  memcpy(rb, payload, len);
  rb[len] = 0;
  JsonDocument r;
  if (deserializeJson(r, (const char*)rb)) return;
  lastCmdRx = millis();
  terimaBalasan(r);
}

bool mqttSambung() {
  String cid = String("siaga-") + DEVICE_ID + "-" + String(ESP.getChipId());
  Serial.printf("MQTT: menyambung ke %s:%d ...\n", MQTT_HOST, (int)MQTT_PORT);
  // Pesan wasiat: bila alat mati mendadak, broker menerbitkan "offline" (retained) di topik status
  bool ok = mqtt.connect(cid.c_str(), MQTT_USER, MQTT_PASS, tStatus.c_str(), 1, true, "offline");
  if (!ok) {
    int st = mqtt.state();
    Serial.printf("MQTT gagal, kode %d (%s)\n", st,
                  st == 4 ? "user/sandi salah" : st == 5 ? "tidak diizinkan" : st == -2 ? "broker tidak terjangkau (host/port/TLS, atau Wi-Fi tanpa internet)" : "lihat TUTORIAL.md bagian 12");
    return false;
  }
  mqtt.subscribe(tCmd.c_str());
  mqtt.publish(tStatus.c_str(), "online", true);
  lastCmdRx = millis();
  Serial.printf("MQTT tersambung. Telemetri: %s | perintah: %s\n", tTele.c_str(), tCmd.c_str());
  return true;
}

// Dipanggil tiap putaran loop
void mqttJaga() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (mqtt.connected()) {
    mqtt.loop();
    return;
  }
  // Putus: matikan pompa SEBELUM menyambung ulang (menyambung TLS bisa memblokir beberapa detik)
  failSafePompa("sambungan MQTT putus, pompa dimatikan");
  if (millis() - lastMqttTry >= MQTT_RETRY_MS) {
    lastMqttTry = millis();
    mqttSambung();
  }
}

bool kirimMqtt(const String& payload) {
  if (!mqtt.connected()) {
    failCount++;
    return false;
  }
  if (!mqtt.publish(tTele.c_str(), payload.c_str())) {
    failCount++;
    Serial.println(F("MQTT: publish gagal (paket lebih besar dari buffer?)"));
    return false;
  }
  return true;
}
#endif

// =====================================================
// 22b. GANTI WI-FI: percobaan aman, portal setup, pindai untuk dashboard
// =====================================================

String htmlEsc(const String& x) {
  String o;
  for (unsigned i = 0; i < x.length(); i++) {
    char c = x[i];
    if (c == '&') o += "&amp;";
    else if (c == '<') o += "&lt;";
    else if (c == '>') o += "&gt;";
    else if (c == '"') o += "&quot;";
    else o += c;
  }
  return o;
}

// Coba Wi-Fi baru TANPA menyimpan. Disimpan hanya bila berhasil (wifiTrialJaga); bila gagal kembali ke yang lama.
void wifiGanti(const char* ssid, const char* pass, unsigned long tok, bool remote) {
  trial.prev = wcfg;
  char oss[33], opp[65];
  salin(oss, wifiSsidAktif(), 33);
  salin(opp, wifiPassAktif(), 65);
  salin(wcfg.ssid, ssid, 33);
  salin(wcfg.pass, pass, 65);
  if (strcmp(oss, ssid) != 0) {          // Wi-Fi yang sedang dipakai menjadi cadangan
    salin(wcfg.ssidB, oss, 33);
    salin(wcfg.passB, opp, 65);
  }
  trial.tok = tok;
  trial.remote = remote;
  trial.t0 = millis();
  trial.aktif = true;
  Serial.printf("Wi-Fi: mencoba \"%s\" (belum disimpan; kembali ke Wi-Fi lama bila gagal dalam %d detik)\n", ssid, (int)(TRIAL_MS / 1000));
  WiFi.disconnect();
  WiFi.begin(ssid, pass);
}

void wifiTrialJaga() {
  if (!trial.aktif) return;
  bool wifiOk = WiFi.status() == WL_CONNECTED && WiFi.SSID() == String(wcfg.ssid);
  // Dari dashboard: berhasil bila Wi-Fi tersambung DAN server sudah membalas lewat jalur baru (broker/HTTP terjangkau).
  // Dari portal: cukup tersambung ke Wi-Fi (pengguna tidak punya cara lain untuk mencoba lagi).
  bool linkOk = !trial.remote || (lastServerRx != 0 && lastServerRx >= trial.t0);
  if (wifiOk && linkOk) {
    saveNet();
    trial.aktif = false;
    if (trial.tok) { wifiRes = 1; wifiResTok = trial.tok; }
    sendNow = true;
    Serial.printf("Wi-Fi \"%s\" tersambung dan DISIMPAN di alat.\n", wcfg.ssid);
  } else if (millis() - trial.t0 > TRIAL_MS) {
    Serial.printf("Wi-Fi \"%s\" GAGAL (sandi salah, sinyal lemah, atau server tidak terjangkau). Kembali ke \"%s\".\n", wcfg.ssid, trial.prev.ssid[0] ? trial.prev.ssid : WIFI_SSID);
    wcfg = trial.prev;
    trial.aktif = false;
    if (trial.tok) { wifiRes = 2; wifiResTok = trial.tok; }
    sendNow = true;
    WiFi.disconnect();
    WiFi.begin(wifiSsidAktif(), wifiPassAktif());
  }
}

// ---- Portal setup (hotspot SIAGA-SETUP, alamat 192.168.4.1) ----
void portalHalaman() {
  int n = WiFi.scanNetworks();
  if (n < 0) n = 0;
  if (n > 30) n = 30;
  String h = "<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>SIAGA setup</title>";
  h += "<style>body{font-family:sans-serif;max-width:480px;margin:16px auto;padding:0 12px}input,select,button{width:100%;padding:10px;margin:6px 0;font-size:16px;box-sizing:border-box}</style></head><body>";
  h += "<h2>SIAGA BANJIR - Wi-Fi alat</h2><p><b>Alat:</b> ";
  h += DEVICE_ID;
  h += " (v";
  h += FW_VERSION;
  h += ")<br><b>Wi-Fi sekarang:</b> ";
  h += (WiFi.status() == WL_CONNECTED) ? htmlEsc(WiFi.SSID()) : String("belum tersambung");
  h += "<br><b>Tersimpan di alat:</b> ";
  h += wcfg.ssid[0] ? htmlEsc(String(wcfg.ssid)) : String("(kosong, memakai bawaan konfigurasi.h)");
  h += "<br><b>Cadangan:</b> ";
  h += wcfg.ssidB[0] ? htmlEsc(String(wcfg.ssidB)) : String("-");
  h += "</p><form method=POST action=/simpan><label>Pilih Wi-Fi (2,4 GHz)</label><select name=p><option value=''>-- pilih --</option>";
  for (int i = 0; i < n; i++) {
    String sd = WiFi.SSID(i);
    if (sd.length() == 0) continue;
    bool dup = false;
    for (int j = 0; j < i; j++) if (WiFi.SSID(j) == sd) dup = true;
    if (dup) continue;
    h += "<option value=\"";
    h += htmlEsc(sd);
    h += "\">";
    h += htmlEsc(sd);
    h += " (";
    h += String((int)WiFi.RSSI(i));
    h += " dBm";
    h += (WiFi.encryptionType(i) == ENC_TYPE_NONE) ? "" : ", terkunci";
    h += ")</option>";
  }
  WiFi.scanDelete();
  h += "</select><label>atau ketik nama Wi-Fi</label><input name=m maxlength=32 autocomplete=off>";
  h += "<label>Sandi Wi-Fi</label><input type=password name=k maxlength=64 autocomplete=off>";
  h += "<button>Simpan dan sambungkan</button></form><p><a href=/>Muat ulang daftar</a></p></body></html>";
  portal.send(200, "text/html", h);
}

void portalSimpan() {
  String ssid = portal.arg("m");
  if (ssid.length() == 0) ssid = portal.arg("p");
  String pass = portal.arg("k");
  if (ssid.length() < 1 || ssid.length() > 32 || (pass.length() > 0 && (pass.length() < 8 || pass.length() > 64))) {
    portal.send(400, "text/html", "<meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><p>Nama Wi-Fi 1-32 karakter; sandi kosong atau 8-64 karakter.</p><p><a href=/>Kembali</a></p>");
    return;
  }
  if (trial.aktif || pumpRunning) {
    portal.send(409, "text/html", "<meta charset=utf-8><p>Alat sedang sibuk (mencoba Wi-Fi lain atau pompa menyala). Coba lagi sebentar.</p><p><a href=/>Kembali</a></p>");
    return;
  }
  String msg = "<meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><p>Alat mencoba tersambung ke <b>";
  msg += htmlEsc(ssid);
  msg += "</b>. Bila berhasil, Wi-Fi ini disimpan dan hotspot SIAGA-SETUP padam. Bila gagal dalam 45 detik, alat kembali ke Wi-Fi lama dan hotspot tetap ada: sambungkan lagi dan ulangi. Cek status di dashboard.</p>";
  portal.send(200, "text/html", msg);
  delay(300);
  wifiGanti(ssid.c_str(), pass.c_str(), 0, false);
}

void portalMulai(bool manual) {
  if (portalOn) return;
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP("SIAGA-SETUP", SETUP_AP_PASS);
  portal.on("/", HTTP_GET, portalHalaman);
  portal.on("/simpan", HTTP_POST, portalSimpan);
  portal.begin();
  portalOn = true;
  portalManual = manual;
  portalSince = millis();
  Serial.printf("Portal setup AKTIF: sambungkan HP ke Wi-Fi \"SIAGA-SETUP\" (sandi %s), buka http://192.168.4.1\n", SETUP_AP_PASS);
}

void portalBerhenti() {
  if (!portalOn) return;
  portal.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  portalOn = false;
  Serial.println(F("Portal setup dimatikan."));
}

// Dipanggil tiap putaran loop: reconnect bergilir, portal otomatis, percobaan Wi-Fi baru
void wifiJaga() {
  unsigned long ms = millis();
  wifiTrialJaga();
  if (portalOn) portal.handleClient();

  if (WiFi.status() == WL_CONNECTED) {
    wifiDownSince = 0;
    if (!wifiUpSince) wifiUpSince = ms ? ms : 1;
    unsigned long dasar = wifiUpSince > portalSince ? wifiUpSince : portalSince;
    if (portalOn && !trial.aktif && ms - dasar > (portalManual ? 600000UL : 60000UL)) portalBerhenti();
  } else {
    wifiUpSince = 0;
    if (!wifiDownSince) wifiDownSince = ms ? ms : 1;
    if (!portalOn && !trial.aktif && ms - wifiDownSince > 40000UL) portalMulai(false);
    if (!trial.aktif && ms - lastWifiTry >= 10000) {   // coba bergilir: aktif, cadangan, bawaan
      lastWifiTry = ms;
      const char* ss[3];
      const char* pp[3];
      int n = wifiDaftar(ss, pp);
      wifiIdx = (wifiIdx + 1) % n;
      WiFi.disconnect();
      WiFi.begin(ss[wifiIdx], pp[wifiIdx]);
    }
  }
}

// Pindai jaringan untuk daftar di dashboard (8 terkuat, tanpa nama kembar/tersembunyi)
void wifiScanLapor() {
  scanPending = false;
  Serial.println(F("Wi-Fi: memindai jaringan untuk dashboard..."));
  int n = WiFi.scanNetworks();
  if (n < 0) n = 0;
  if (n > 40) n = 40;
  bool used[40];
  for (int i = 0; i < 40; i++) used[i] = false;
  int idx[8];
  int m = 0;
  while (m < 8) {
    int best = -1;
    for (int i = 0; i < n; i++) {
      if (used[i]) continue;
      if (WiFi.SSID(i).length() == 0) { used[i] = true; continue; }
      if (best < 0 || WiFi.RSSI(i) > WiFi.RSSI(best)) best = i;
    }
    if (best < 0) break;
    used[best] = true;
    bool dup = false;
    for (int j = 0; j < m; j++) if (WiFi.SSID(idx[j]) == WiFi.SSID(best)) dup = true;
    if (!dup) idx[m++] = best;
  }
  JsonDocument d;
  d["id"] = DEVICE_ID;
  d["key"] = DEVICE_KEY;
  d["tok"] = scanTokNow;
  JsonArray a = d["list"].to<JsonArray>();
  for (int k = 0; k < m; k++) {
    JsonObject o = a.add<JsonObject>();
    o["s"] = WiFi.SSID(idx[k]);
    o["r"] = (int)WiFi.RSSI(idx[k]);
    o["e"] = (WiFi.encryptionType(idx[k]) == ENC_TYPE_NONE) ? 0 : 1;
  }
  WiFi.scanDelete();
  String payload;
  serializeJson(d, payload);
#if PAKAI_MQTT
  String t = String(MQTT_PREFIX) + "/" + DEVICE_ID + "/wifi";
  if (!mqtt.publish(t.c_str(), payload.c_str())) Serial.println(F("Wi-Fi: daftar gagal dikirim (paket besar atau MQTT putus)"));
#else
  kirimHttpKe(payload, "/api/device/wifi", false);
#endif
  Serial.printf("Wi-Fi: %d jaringan dikirim ke dashboard\n", m);
}

// Perintah Wi-Fi dari server (dititipkan di balasan yang sama dengan perintah pompa)
void parseWifiCommand(JsonDocument& r) {
  unsigned long st = r["wifi_scan"] | 0UL;
  if (st != 0 && st != lastScanTok) {
    lastScanTok = st;
    scanTokNow = st;
    scanPending = true;
  }
  JsonObject w = r["wifi_set"];
  if (!w.isNull()) {
    unsigned long tok = w["tok"] | 0UL;
    const char* ssid = w["ssid"] | "";
    const char* pass = w["pass"] | "";
    if (tok != 0 && tok != lastSetTok && ssid[0] && !pumpRunning && !trial.aktif) {
      lastSetTok = tok;
      wifiGanti(ssid, pass, tok, true);
    }
  }
}

bool sendData() {
  if (WiFi.status() != WL_CONNECTED) {
    failCount++;
    return false;
  }

  String payload;
  bangunPayload(payload, PAKAI_MQTT);
#if PAKAI_MQTT
  bool ok = kirimMqtt(payload);    // balasan server datang belakangan lewat onMqtt()
#else
  bool ok = kirimHttp(payload);
#endif

  if (failCount >= 3) failSafePompa("koneksi ke server putus, pompa dimatikan");
  return ok;
}

// =====================================================
// 23. SETUP
// =====================================================

void setup() {
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  tulisPompa(false);          // tulis level MATI dulu, baru jadikan OUTPUT (hindari relay klik saat boot)
  pinMode(PIN_PUMP, OUTPUT);

  digitalWrite(PIN_LED, LOW);
  digitalWrite(PIN_BUZZER, HIGH); // Tahan modul low-level agar mati saat boot
  tulisPompa(false);

  Serial.begin(115200);
  delay(200);

  analogWriteRange(1023);
  analogWriteFreq(1000);

  Serial.println("\nDESA SIAGA BANJIR - V3.1 (MQTT, ISI SAMPAI TARGET, GANTI WI-FI TANPA COMPILE)");

  loadCal();
  loadNet();
  resetFilter(filt);
  Serial.printf("Tinwall %.1f x %.1f x %.1f cm | %.1f ml per cm | WASPADA %.0f ml, SIAGA %.0f ml, AWAS %.0f ml, penuh %.0f ml\n",
                TINWALL_P_CM, TINWALL_L_CM, TANK_CM, TINWALL_P_CM * TINWALL_L_CM,
                thW() * TINWALL_P_CM * TINWALL_L_CM, thS() * TINWALL_P_CM * TINWALL_L_CM,
                thA() * TINWALL_P_CM * TINWALL_L_CM, TANK_CM * TINWALL_P_CM * TINWALL_L_CM);
  Serial.printf("Jarak dasar %.2f cm. Kirim 'k' (tangki KOSONG) untuk kalibrasi dasar otomatis.\n", thD0());
  secureClient.setInsecure();
  secureClient.setBufferSizes(512, 512);
#if PAKAI_MQTT
  tTele = String(MQTT_PREFIX) + "/" + DEVICE_ID + "/telemetry";
  tCmd = String(MQTT_PREFIX) + "/" + DEVICE_ID + "/cmd";
  tStatus = String(MQTT_PREFIX) + "/" + DEVICE_ID + "/status";
  if (MQTT_TLS) mqtt.setClient(secureClient); else mqtt.setClient(plainClient);
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMqtt);
  mqtt.setBufferSize(768);
  mqtt.setKeepAlive(15);
  mqtt.setSocketTimeout(5);
  Serial.printf("Jalur data: MQTT %s:%d (%s), awalan topik \"%s\"\n", MQTT_HOST, (int)MQTT_PORT, MQTT_TLS ? "TLS" : "tanpa TLS", MQTT_PREFIX);
#else
  Serial.printf("Jalur data: HTTP ke %s\n", SERVER_URL);
#endif
  connectWifi(15000);
  if (WiFi.status() != WL_CONNECTED) wifiDownSince = 1;   // portal setup terbuka sekitar 40 detik sejak menyala bila Wi-Fi belum tersambung
  Serial.println(F("Perintah Serial: k = kalibrasi dasar (tangki KOSONG), p = uji relay, w = buka hotspot setup Wi-Fi, x = hapus Wi-Fi tersimpan"));
}

// =====================================================
// 24. LOOP
// =====================================================

void loop() {
  unsigned long ms = millis();

  // Perintah Serial: 'k' = kalibrasi dasar (tangki KOSONG)
  while (Serial.available()) {
    char ch = (char)Serial.read();
    if (ch == 'k' || ch == 'K') kalibrasiDasarSerial();
    if (ch == 'p' || ch == 'P') ujiRelaySerial();
    if (ch == 'w' || ch == 'W') portalMulai(true);
    if (ch == 'x' || ch == 'X') {
      memset(&wcfg, 0, sizeof(wcfg));
      wcfg.magic = NET_MAGIC;
      saveNet();
      Serial.println(F("Wi-Fi tersimpan dihapus. Setelah restart alat memakai Wi-Fi dari konfigurasi.h."));
    }
  }

  // -------------------------------------------------
  // PENGUKURAN SENSOR
  // -------------------------------------------------
  unsigned long measureInterval = pumpRunning ? 500UL : 1000UL;
  if (ms - lastMeasure >= measureInterval) {
    lastMeasure = ms;
    float d = readMedianCm();

    if (d < 0) {
      sensorOk = false;
      if (++sensorErrCount >= 5) {
        sensorFault = true;
      }
      Serial.println("Sensor: tidak ada pembacaan");
    } else {
      GeomMaket g = geom();
      Vonis v = jendela(g, d);

      if (v != V_OK) {
        // Bacaan mustahil (di luar jendela jarak): TIDAK dijadikan tinggi air.
        sensorOk = false;
        if (++sensorErrCount >= 5) {
          sensorFault = true;
        }
        Serial.printf("Sensor: jarak %.1f cm di luar jendela %s -> diabaikan\n", d,
                      v == V_JAUH ? "(lebih jauh dari dasar: cek kalibrasi dasar / sensor miring)"
                                  : "(terlalu dekat: bibir wadah/percikan/terhalang)");
      } else {
        sensorOk = true;
        sensorFault = false;
        sensorErrCount = 0;
        distanceCm = d;

        float lv = levelMentah(g, cal.k, cal.l0, d);   // 0..TANK_CM, tidak pernah minus
        Vonis f = langkah(filt, g, lv, EMA_ALPHA, MAX_TOLAK);
        if (f == V_LONJAKAN) {
          Serial.printf("Lonjakan %.2f cm diabaikan (tinggi tersaring tetap %.2f)\n", lv, filt.nilai);
        }
        level = filt.nilai;

        updateStatus(level);

        Serial.printf("Jarak %.1f cm | Maket %.2f cm | Lapangan %.2f m | %s | Pompa:%s\n",
                      d, level, level * cal.skala / 100.0f, STATUS_TXT[status],
                      pumpRunning ? "ON" : "OFF");
      }
    }
  }

  // -------------------------------------------------
  // RIWAYAT SENSOR 60 DETIK
  // -------------------------------------------------
  if (ms - lastHist >= 5000) {
    lastHist = ms;
    if (sensorOk) {
      if (histCount == 12) {
        rateCm = level - hist[histIdx];
      }
      hist[histIdx] = level;
      histIdx = (histIdx + 1) % 12;
      if (histCount < 12) histCount++;
    }
  }

  // -------------------------------------------------
  // ALARM DAN POMPA
  // -------------------------------------------------
#if PAKAI_MQTT
  mqttJaga();
  // Pompa sedang diperintah tetapi server tidak membalas (server/broker mati, Wi-Fi putus): matikan pompa
  if (pumpMode != PUMP_OFF && ms - lastCmdRx > CMD_TIMEOUT_MS) failSafePompa("tidak ada balasan dari server, pompa dimatikan");
#endif
  handleAlarm();
  handlePump();

  // -------------------------------------------------
  // PENGIRIMAN DATA
  // -------------------------------------------------
  unsigned long sendInterval = pumpRunning ? 1500UL : (DEMO_MODE ? 3000UL : 5000UL);
  if (sendNow || ms - lastSend >= sendInterval) {
    lastSend = ms;
    sendNow = false;
    sendData();
  }

  // -------------------------------------------------
  // WI-FI: reconnect bergilir, portal setup, percobaan Wi-Fi baru
  // -------------------------------------------------
  wifiJaga();
  if (scanPending && !pumpRunning && !trial.aktif && WiFi.status() == WL_CONNECTED) wifiScanLapor();
}
