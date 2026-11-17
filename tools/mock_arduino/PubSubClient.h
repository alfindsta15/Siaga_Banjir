#pragma once
#include "ESP8266WiFi.h"
// Tiruan seperlunya agar sintaks sketsa bisa diperiksa di komputer. Bukan PubSubClient asli.
class PubSubClient {
 public:
  PubSubClient() {}
  PubSubClient& setClient(WiFiClient&) { return *this; }
  PubSubClient& setServer(const char*, uint16_t) { return *this; }
  PubSubClient& setCallback(void (*)(char*, uint8_t*, unsigned int)) { return *this; }
  bool setBufferSize(uint16_t) { return true; }
  PubSubClient& setKeepAlive(uint16_t) { return *this; }
  PubSubClient& setSocketTimeout(uint16_t) { return *this; }
  bool connect(const char*, const char*, const char*, const char*, uint8_t, bool, const char*) { return false; }
  bool connected() { return false; }
  bool publish(const char*, const char*) { return true; }
  bool publish(const char*, const char*, bool) { return true; }
  bool subscribe(const char*) { return true; }
  bool loop() { return true; }
  int state() { return 0; }
  void disconnect() {}
};
