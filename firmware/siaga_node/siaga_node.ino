/*
  SIAGA BANJIR - node sensor ESP32 + sensor jarak A02YYUW (UART)
  Library (Library Manager): ArduinoJson v7. Papan: ESP32 (Espressif).
  Alarm lokal (LED + buzzer) TETAP bekerja tanpa internet; angka kalibrasi disimpan di memori (NVS)
  dan diperbarui dari server setiap kali kirim data berhasil.
*/
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include "config.h"

#define PIN_SENSOR_RX 16   // ke pin TX sensor
#define PIN_SENSOR_TX 17   // tidak dipakai (boleh dibiarkan)
#define PIN_LED_G 25
#define PIN_LED_Y 26
#define PIN_LED_R 27
#define PIN_BUZZER 14      // ke basis transistor NPN lewat resistor 1k (buzzer aktif)
#define PIN_TEST 33        // tombol uji ke GND

struct Cfg { float base = 400, w = 150, s = 250, a = 320, laju = 90; int hys = 3; int interval = 60; bool siren = true; } cfg;
struct Hist { unsigned long t; float h; } hist[30];
int hn = 0, level = 0, turun = 0, errN = 0;
bool sensorErr = false, pertama = true;
unsigned long tUkur = 0, tWifi = 0, tBtn = 0, testSampai = 0;
Preferences prefs;

void muatCfg() {
  prefs.begin("siaga", true);
  cfg.base = prefs.getFloat("base", cfg.base); cfg.w = prefs.getFloat("w", cfg.w); cfg.s = prefs.getFloat("s", cfg.s);
  cfg.a = prefs.getFloat("a", cfg.a); cfg.laju = prefs.getFloat("laju", cfg.laju);
  cfg.hys = prefs.getInt("hys", cfg.hys); cfg.interval = prefs.getInt("int", cfg.interval); cfg.siren = prefs.getBool("siren", cfg.siren);
  prefs.end();
}
void terapkanCfg(JsonObject c) {
  cfg.base = c["base"] | cfg.base; cfg.w = c["waspada"] | cfg.w; cfg.s = c["siaga"] | cfg.s; cfg.a = c["awas"] | cfg.a;
  cfg.laju = c["laju"] | cfg.laju; cfg.hys = c["hys"] | cfg.hys; cfg.interval = c["interval"] | cfg.interval; cfg.siren = c["siren"] | cfg.siren;
  if (cfg.interval < 5) cfg.interval = 5;
  prefs.begin("siaga", false);
  prefs.putFloat("base", cfg.base); prefs.putFloat("w", cfg.w); prefs.putFloat("s", cfg.s); prefs.putFloat("a", cfg.a); prefs.putFloat("laju", cfg.laju);
  prefs.putInt("hys", cfg.hys); prefs.putInt("int", cfg.interval); prefs.putBool("siren", cfg.siren);
  prefs.end();
}

// Sensor A02YYUW: bingkai 4 byte 0xFF, H, L, SUM; jarak (mm) = H*256+L. Cek lembar data modul Anda.
bool bacaBingkai(int &mm) {
  while (Serial2.available() >= 4) {
    if (Serial2.peek() != 0xFF) { Serial2.read(); continue; }
    uint8_t b[4]; Serial2.readBytes(b, 4);
    if (((b[0] + b[1] + b[2]) & 0xFF) == b[3]) { mm = b[1] * 256 + b[2]; return true; }
  }
  return false;
}
float bacaCm() {   // median 5 bacaan; -1 bila gagal
  while (Serial2.available()) Serial2.read();
  float v[5]; int n = 0; unsigned long t0 = millis(); int mm;
  while (n < 5 && millis() - t0 < 3000) { if (bacaBingkai(mm)) { if (mm >= 30 && mm <= 5000) v[n++] = mm / 10.0f; } else delay(5); }
  if (n < 3) return -1;
  for (int i = 0; i < n - 1; i++) for (int j = i + 1; j < n; j++) if (v[j] < v[i]) { float t = v[i]; v[i] = v[j]; v[j] = t; }
  return v[n / 2];
}

float hitungLaju(float h) {   // cm/jam, dari data 3-15 menit lalu
  unsigned long now = millis();
  for (int i = 0; i < hn; i++) { unsigned long dt = now - hist[i].t; if (dt >= 180000UL && dt <= 900000UL) return (h - hist[i].h) / (dt / 3600000.0f); }
  return 0;
}
void simpanHist(float h) {
  if (hn == 30) { memmove(&hist[0], &hist[1], 29 * sizeof(Hist)); hn = 29; }
  hist[hn].t = millis(); hist[hn].h = h; hn++;
}
int levelDari(float h, float lj) {   // sama dengan logika server
  if (h >= cfg.a || (lj >= cfg.laju && h >= cfg.w)) return 3;
  if (h >= cfg.s) return 2;
  if (h >= cfg.w) return 1;
  return 0;
}

void kirim(float dist) {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http; WiFiClientSecure sc; WiFiClient pc;
  String url = String(SERVER_URL) + "/api/device/telemetry";
  if (url.startsWith("https")) { sc.setInsecure(); http.begin(sc, url); } else http.begin(pc, url);   // setInsecure: tidak memeriksa sertifikat
  http.setTimeout(6000);
  http.addHeader("Content-Type", "application/json"); http.addHeader("X-Device-Key", DEVICE_KEY);
  JsonDocument d; d["id"] = DEVICE_ID; d["lvl"] = level; d["rssi"] = WiFi.RSSI(); d["up"] = millis() / 1000; d["fw"] = FW_VERSION;
  if (dist > 0) d["dist"] = dist; else d["err"] = 1;
  String body; serializeJson(d, body);
  int code = http.POST(body);
  Serial.printf("kirim -> HTTP %d\n", code);
  if (code == 200) {
    JsonDocument r;
    if (!deserializeJson(r, http.getString())) { JsonObject c = r["cfg"]; if (!c.isNull()) terapkanCfg(c); }
  }
  http.end();
}

void ukurDanKirim() {
  float dist = bacaCm();
  if (dist < 0) { errN++; sensorErr = errN >= 3; Serial.println("sensor gagal membaca"); }
  else {
    errN = 0; sensorErr = false;
    float h = cfg.base - dist, lj = hitungLaju(h);
    int baru = levelDari(h, lj);
    if (baru > level) { level = baru; turun = 0; }
    else if (baru < level) { if (++turun >= cfg.hys) { level = baru; turun = 0; } }
    else turun = 0;
    simpanHist(h);
    Serial.printf("jarak=%.1f tinggi=%.1f laju=%.0f level=%d\n", dist, h, lj, level);
  }
  kirim(dist);
}

void keluaran() {
  unsigned long n = millis(); bool uji = n < testSampai; int l = uji ? 3 : level;
  digitalWrite(PIN_LED_G, l == 0 && !sensorErr);
  digitalWrite(PIN_LED_Y, (l == 1 && (n / 600) % 2) || l == 2);
  digitalWrite(PIN_LED_R, l == 3 || (sensorErr && (n / 150) % 2));
  digitalWrite(PIN_BUZZER, (l == 3 && (cfg.siren || uji) && (n / 500) % 2) ? HIGH : LOW);
}

void setup() {
  Serial.begin(115200);
  Serial2.begin(9600, SERIAL_8N1, PIN_SENSOR_RX, PIN_SENSOR_TX);
  pinMode(PIN_LED_G, OUTPUT); pinMode(PIN_LED_Y, OUTPUT); pinMode(PIN_LED_R, OUTPUT); pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_TEST, INPUT_PULLUP);
  muatCfg();
  WiFi.mode(WIFI_STA); WiFi.begin(WIFI_SSID, WIFI_PASS);
}

void loop() {
  unsigned long n = millis();
  if (WiFi.status() != WL_CONNECTED && n - tWifi > 15000) { tWifi = n; WiFi.disconnect(); WiFi.begin(WIFI_SSID, WIFI_PASS); }
  if (digitalRead(PIN_TEST) == LOW && n - tBtn > 1000) { tBtn = n; testSampai = n + 3000; }   // uji lampu + sirine 3 detik
  if (pertama || n - tUkur >= (unsigned long)cfg.interval * 1000UL) { pertama = false; tUkur = n; ukurDanKirim(); }
  keluaran(); delay(20);
}
