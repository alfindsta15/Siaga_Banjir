#pragma once
// Header TIRUAN seperlunya agar sketsa ESP8266 bisa diperiksa sintaksnya di komputer. Bukan Arduino asli.
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include <math.h>
#include <string>
typedef bool boolean; typedef uint8_t byte;
#define HIGH 1
#define LOW 0
#define OUTPUT 1
#define INPUT 0
#define INPUT_PULLUP 2
#define D0 16
#define D1 5
#define D2 4
#define D3 0
#define D4 2
#define D5 14
#define D6 12
#define D7 13
#define D8 15
#define LED_BUILTIN 2
#define F(x) (x)
class String : public std::string {
 public:
  String() {} String(const char* s) : std::string(s ? s : "") {} String(const std::string& s) : std::string(s) {}
  String(int v) : std::string(std::to_string(v)) {} String(unsigned long v) : std::string(std::to_string(v)) {}
  String(float v, int dec = 2) { char b[40]; snprintf(b, sizeof b, "%.*f", dec, v); assign(b); }
  String operator+(const String& o) const { return String(std::string(*this) + std::string(o)); }
  String operator+(const char* o) const { return String(std::string(*this) + o); }
  const char* c_str_() const { return c_str(); }
};
struct SerialMock {
  void begin(long) {} int available() { return 0; } int read() { return -1; }
  void println() {} void println(const char*) {} void println(const String&) {} void println(int) {} void println(float) {}
  void print(const char*) {} void print(const String&) {} void print(int) {} void print(float) {}
  int printf(const char* f, ...) __attribute__((format(printf, 2, 3))) { va_list a; va_start(a, f); int n = vprintf(f, a); va_end(a); return n; }
};
static SerialMock Serial;
inline void pinMode(int, int) {} inline void digitalWrite(int, int) {} inline int digitalRead(int) { return 0; }
inline void analogWrite(int, int) {} inline void analogWriteRange(int) {} inline void analogWriteFreq(int) {}
inline void delay(unsigned long) {} inline void delayMicroseconds(unsigned int) {} inline void yield() {}
inline unsigned long millis() { return 0; } inline unsigned long micros() { return 0; }
inline void tone(int, unsigned int) {} inline void noTone(int) {}
inline unsigned long pulseIn(int, int, unsigned long) { return 0; }
struct EspMock { void restart() {} unsigned long getChipId() { return 1; } } static ESP;
