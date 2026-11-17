#pragma once
#include "ESP8266WiFi.h"
class WiFiClientSecure : public WiFiClient { public: void setInsecure() {} void setBufferSizes(int, int) {} };
