/*
  DESA SIAGA BANJIR - ESP8266 (NodeMCU)
  Sensor HC-SR04, LED merah + buzzer (Siaga), pompa 5 V lewat MOSFET.

  Papan : NodeMCU 1.0 (ESP-12E Module), ESP8266 core 3.x
  Pin   : D1 TRIG | D2 ECHO (lewat pembagi tegangan 1k/2k!)
          D5 LED merah | D6 Buzzer aktif | D7 MOSFET pompa

  Alur  : tiap 5 detik ESP8266 mengirim data (JSON) ke server dan
          menerima perintah pompa. Peringatan lokal (LED + buzzer)
          tetap jalan walau Wi-Fi/server mati.
*/

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <time.h>

// ================== KONFIGURASI (ISI SESUAI KEBUTUHAN) ==================
const char* WIFI_SSID  = "NAMA_WIFI";
const char* WIFI_PASS  = "PASSWORD_WIFI";
const char* SERVER_URL = "https://contoh.server/api/data";  // endpoint server
const char* API_TOKEN  = "GANTI_TOKEN_RAHASIA";
const char* DEVICE_ID  = "maket-01";

// Kalibrasi maket (ukur dengan penggaris!)
const float H_CM    = 22.0;   // jarak muka sensor ke dasar tangki (cm)
const float TANK_CM = 10.0;   // tinggi tangki (cm)
const float SKALA   = 20.0;   // 1 cm maket = 20 cm sungai nyata

// Ambang status (cm di maket) dan histeresis
const float WASPADA_CM = 3.0;
const float SIAGA_CM   = 6.0;
const float HIST_CM    = 0.5;

// Pengaman pompa
const float         PUMP_MAX_CM = 8.5;      // pompa berhenti di tinggi ini
const unsigned long PUMP_MAX_MS = 60000UL;  // batas nyala maksimal (60 detik)

// Deteksi air naik cepat
const float RISE_ALERT_CM = 1.0;            // naik >= 1 cm dalam ~60 detik

// Mode demo: kirim lebih sering (3 detik)
const bool DEMO_MODE = false;

// ================== PIN ==================
const uint8_t PIN_TRIG   = D1;
const uint8_t PIN_ECHO   = D2;
const uint8_t PIN_LED    = D5;
const uint8_t PIN_BUZZER = D6;
const uint8_t PIN_PUMP   = D7;

// ================== VARIABEL ==================
enum Status { NORMAL = 0, WASPADA = 1, SIAGA = 2 };
const char* STATUS_TXT[] = {"NORMAL", "WASPADA", "SIAGA"};

Status status = NORMAL;
float distanceCm = 0;
float level = 0;            // tinggi air (cm di maket)
bool  sensorOk = false;
bool  sensorFault = false;
int   sensorErrCount = 0;

// Pompa
bool pumpRequested = false; // perintah dari server
bool pumpRunning   = false;
bool pumpLockout   = false;
unsigned long pumpStart = 0;

// Waktu
unsigned long lastMeasure = 0;
unsigned long lastSend    = 0;
unsigned long lastHist    = 0;
unsigned long lastWifiTry = 0;
unsigned long lastBeep    = 0;
bool beepState = false;
bool sendNow   = false;

// Riwayat 60 detik (12 titik x 5 detik)
float hist[12];
int   histIdx = 0, histCount = 0;
float rateCm = 0;           // kenaikan cm per ~60 detik

int failCount = 0;
WiFiClientSecure client;

// ================== SENSOR ==================
float readDistanceCm() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(3);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  unsigned long us = pulseIn(PIN_ECHO, HIGH, 30000UL);
  if (us == 0) return -1;
  return us * 0.0343f / 2.0f;
}

// Median 5 pembacaan agar angka stabil
float readMedianCm() {
  const int N = 5;
  float v[N];
  int n = 0;
  for (int i = 0; i < N; i++) {
    float d = readDistanceCm();
    if (d >= 2.0 && d <= 400.0) v[n++] = d;
    delay(50);
  }
  if (n < 3) return -1;
  for (int i = 1; i < n; i++) {           // urut (insertion sort)
    float key = v[i];
    int j = i - 1;
    while (j >= 0 && v[j] > key) { v[j + 1] = v[j]; j--; }
    v[j + 1] = key;
  }
  return v[n / 2];
}

// ================== STATUS ==================
void updateStatus(float lv) {
  Status old = status;
  switch (status) {
    case NORMAL:
      if (lv >= SIAGA_CM) status = SIAGA;
      else if (lv >= WASPADA_CM) status = WASPADA;
      break;
    case WASPADA:
      if (lv >= SIAGA_CM) status = SIAGA;
      else if (lv < WASPADA_CM - HIST_CM) status = NORMAL;
      break;
    case SIAGA:
      if (lv < SIAGA_CM - HIST_CM) status = (lv >= WASPADA_CM) ? WASPADA : NORMAL;
      break;
  }
  if (status != old) {
    sendNow = true;   // kirim segera saat status berubah
    Serial.printf("Status berubah: %s -> %s\n", STATUS_TXT[old], STATUS_TXT[status]);
  }
}

// ================== PERINGATAN LOKAL ==================
// LED merah + buzzer berkedip bersamaan saat SIAGA
void handleAlarm() {
  if (status == SIAGA) {
    if (millis() - lastBeep >= 400) {
      lastBeep = millis();
      beepState = !beepState;
      digitalWrite(PIN_LED, beepState);
      digitalWrite(PIN_BUZZER, beepState);
    }
  } else {
    beepState = false;
    digitalWrite(PIN_LED, LOW);
    digitalWrite(PIN_BUZZER, LOW);
  }
}

// ================== POMPA ==================
void setPump(bool on) {
  pumpRunning = on;
  digitalWrite(PIN_PUMP, on ? HIGH : LOW);
  if (on) pumpStart = millis();
  Serial.println(on ? "Pompa: ON" : "Pompa: OFF");
}

void handlePump() {
  if (!pumpRequested) pumpLockout = false;   // reset setelah perintah dimatikan
  bool allow = pumpRequested && !pumpLockout && sensorOk && !sensorFault
               && level < PUMP_MAX_CM;
  if (pumpRunning) {
    if (!allow || millis() - pumpStart >= PUMP_MAX_MS) {
      setPump(false);
      if (pumpRequested) pumpLockout = true; // harus dimatikan lalu dinyalakan lagi
    }
  } else if (allow) {
    setPump(true);
  }
}

// ================== WI-FI & WAKTU ==================
void connectWifi(unsigned long waitMs) {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < waitMs) {
    delay(250);
    Serial.print(".");
  }
  Serial.println(WiFi.status() == WL_CONNECTED ? "\nWi-Fi tersambung" : "\nWi-Fi gagal");
}

// ================== KIRIM DATA ==================
bool sendData() {
  if (WiFi.status() != WL_CONNECTED) { failCount++; return false; }

  time_t now = time(nullptr);
  long ts = (now > 100000) ? (long)now : 0;   // 0 = jam belum sinkron
  int fast = (rateCm >= RISE_ALERT_CM) ? 1 : 0;

  char payload[360];
  snprintf(payload, sizeof(payload),
    "{\"device\":\"%s\",\"ts\":%ld,\"jarak_cm\":%.1f,\"tinggi_cm\":%.1f,"
    "\"tinggi_nyata_m\":%.2f,\"status\":\"%s\",\"naik_cm_per_menit\":%.1f,"
    "\"naik_cepat\":%d,\"pompa\":%d,\"sensor_ok\":%d,\"rssi\":%d,\"uptime_s\":%lu}",
    DEVICE_ID, ts, distanceCm, level, level * SKALA / 100.0f,
    STATUS_TXT[status], rateCm, fast, pumpRunning ? 1 : 0,
    (sensorOk && !sensorFault) ? 1 : 0, WiFi.RSSI(), millis() / 1000UL);

  client.setInsecure();   // demo: tanpa verifikasi sertifikat
  HTTPClient http;
  http.setTimeout(5000);
  if (!http.begin(client, SERVER_URL)) { failCount++; return false; }
  http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Token", API_TOKEN);

  int code = http.POST(payload);
  bool ok = (code == 200);
  if (ok) {
    String body = http.getString();
    body.replace(" ", "");
    pumpRequested = body.indexOf("\"pump\":1") >= 0 || body.indexOf("\"pump\":true") >= 0;
    failCount = 0;
  } else {
    failCount++;
    Serial.printf("Kirim gagal, kode: %d\n", code);
  }
  http.end();

  // Fail-safe: server tidak terjangkau -> pompa dimatikan
  if (failCount >= 3) pumpRequested = false;
  return ok;
}

// ================== SETUP & LOOP ==================
void setup() {
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_PUMP, OUTPUT);
  digitalWrite(PIN_LED, LOW);
  digitalWrite(PIN_BUZZER, LOW);
  digitalWrite(PIN_PUMP, LOW);      // pompa mati saat boot

  Serial.begin(115200);
  Serial.println("\nDESA SIAGA BANJIR - mulai");

  connectWifi(15000);
  configTime(7 * 3600, 0, "pool.ntp.org", "time.google.com");  // WIB (UTC+7)
}

void loop() {
  unsigned long ms = millis();

  // 1) Ukur tiap 1 detik
  if (ms - lastMeasure >= 1000) {
    lastMeasure = ms;
    float d = readMedianCm();
    if (d < 0) {
      sensorOk = false;
      if (++sensorErrCount >= 5) sensorFault = true;
      Serial.println("Sensor: tidak ada pembacaan");
    } else {
      sensorOk = true;
      sensorFault = false;
      sensorErrCount = 0;
      distanceCm = d;
      level = H_CM - d;
      if (level < 0) level = 0;
      if (level > TANK_CM) level = TANK_CM;
      updateStatus(level);
      Serial.printf("Jarak %.1f cm | Tinggi %.1f cm (%.2f m nyata) | %s\n",
                    d, level, level * SKALA / 100.0f, STATUS_TXT[status]);
    }
  }

  // 2) Riwayat tiap 5 detik untuk deteksi naik cepat
  if (ms - lastHist >= 5000) {
    lastHist = ms;
    if (sensorOk) {
      if (histCount == 12) rateCm = level - hist[histIdx];
      hist[histIdx] = level;
      histIdx = (histIdx + 1) % 12;
      if (histCount < 12) histCount++;
    }
  }

  // 3) Peringatan lokal dan pompa (selalu jalan)
  handleAlarm();
  handlePump();

  // 4) Kirim data ke server
  unsigned long interval = DEMO_MODE ? 3000UL : 5000UL;
  if (sendNow || ms - lastSend >= interval) {
    lastSend = ms;
    sendNow = false;
    sendData();
  }

  // 5) Sambung ulang Wi-Fi tiap 10 detik bila putus
  if (WiFi.status() != WL_CONNECTED && ms - lastWifiTry >= 10000) {
    lastWifiTry = ms;
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASS);
  }
}
