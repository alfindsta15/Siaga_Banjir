#pragma once
#include "Arduino.h"
#define WIFI_STA 1
#define WIFI_AP 2
#define WIFI_AP_STA 3
#define WL_CONNECTED 3
#define ENC_TYPE_NONE 7
class WiFiClient { public: virtual ~WiFiClient() {} };
struct WiFiClassMock {
  int status() { return 0; } void mode(int) {} void begin(const char*, const char*) {} void disconnect() {}
  int RSSI() { return 0; } int RSSI(int) { return 0; } String SSID() { return String(""); } String SSID(int) { return String(""); }
  int encryptionType(int) { return 0; } int scanNetworks() { return 0; } void scanDelete() {} bool persistent(bool) { return true; }
  bool softAP(const char*, const char*) { return true; } bool softAPdisconnect(bool) { return true; }
  String localIP_() { return String(""); } };
static WiFiClassMock WiFi;
