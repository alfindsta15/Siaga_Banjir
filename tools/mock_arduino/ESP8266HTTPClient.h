#pragma once
#include "ESP8266WiFi.h"
#define HTTPC_FORCE_FOLLOW_REDIRECTS 2
class HTTPClient { public: bool begin(WiFiClient&, const String&) { return true; } void setTimeout(int) {} void setFollowRedirects(int) {} void addHeader(const char*, const char*) {} void addHeader(const String&, const String&) {} int POST(const String&) { return 200; } String getString() { return String(""); } void end() {} };
