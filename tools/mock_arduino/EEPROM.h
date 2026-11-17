#pragma once
#include "Arduino.h"
struct EEPROMMock { void begin(int) {} template <class T> T& get(int, T& t) { return t; } template <class T> const T& put(int, const T& t) { return t; } bool commit() { return true; } };
static EEPROMMock EEPROM;
