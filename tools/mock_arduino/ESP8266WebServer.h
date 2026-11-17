#pragma once
#include "ESP8266WiFi.h"
#define HTTP_GET 1
#define HTTP_POST 3
class ESP8266WebServer { public:
  ESP8266WebServer(int) {} void on(const char*, int, void (*)()) {} void begin() {} void stop() {} void handleClient() {}
  String arg(const char*) { return String(""); } void send(int, const char*, const String&) {} };
