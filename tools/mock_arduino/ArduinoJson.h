#pragma once
#include "Arduino.h"
class JsonVariant { public: template <class T> T to() { return T(); } template <class T> T add() { return T(); } template <class T> JsonVariant& operator=(const T&) { return *this; } JsonVariant& operator=(const char*) { return *this; } JsonVariant operator[](const char*) const { return JsonVariant(); } };
template <class T> T operator|(const JsonVariant&, T d) { return d; }
class JsonObject : public JsonVariant { public: JsonObject() {} JsonObject(const JsonVariant&) {} bool isNull() const { return false; } };
class JsonArray : public JsonVariant { public: JsonArray() {} JsonArray(const JsonVariant&) {} };
class JsonDocument : public JsonVariant {};
inline int deserializeJson(JsonDocument&, const String&) { return 0; }
inline int serializeJson(const JsonDocument&, String&) { return 0; }
