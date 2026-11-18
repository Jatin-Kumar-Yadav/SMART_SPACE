// Signature-level stubs of the Arduino / ESP32 APIs the generated sketches use. They exist only so g++ can
// type-check generated firmware in CI; they do nothing at run time.
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <string>
typedef uint8_t byte;
typedef bool boolean;
#define F(x) (x)
#define constrain(a, lo, hi) ((a) < (lo) ? (lo) : ((a) > (hi) ? (hi) : (a)))
#define INPUT 0
#define OUTPUT 1
#define HIGH 1
#define LOW 0
#define A0 14
#define A1 15
#define A2 16
#define A3 17
#define A4 18
#define A5 19
#define ADC_11db 3
#ifndef ESP_ARDUINO_VERSION_MAJOR
#define ESP_ARDUINO_VERSION_MAJOR 3
#endif
unsigned long millis();
void delay(unsigned long);
void pinMode(uint8_t, uint8_t);
int digitalRead(uint8_t);
void digitalWrite(uint8_t, uint8_t);
int analogRead(uint8_t);
void analogWrite(uint8_t, int);
void analogSetPinAttenuation(uint8_t, int);
#if ESP_ARDUINO_VERSION_MAJOR >= 3
bool ledcAttach(uint8_t pin, uint32_t freq, uint8_t res);
bool ledcWrite(uint8_t pin, uint32_t duty);
#else
double ledcSetup(uint8_t ch, double freq, uint8_t res);
void ledcAttachPin(uint8_t pin, uint8_t ch);
void ledcWrite(uint8_t ch, uint32_t duty);
#endif
struct String {
  String() {}
  String(const char*) {}
  String(const std::string&) {}
  String operator+(const char*) const { return *this; }
  String operator+(const String&) const { return *this; }
  String& operator=(const String&) = default;
  const char* c_str() const { return ""; }
};
struct SerialPort {
  void begin(unsigned long) {}
  int available() { return 0; }
  int read() { return 0; }
  size_t print(const char*) { return 0; }
  size_t print(char) { return 0; }
  size_t print(int) { return 0; }
  size_t print(unsigned int) { return 0; }
  size_t print(long) { return 0; }
  size_t print(unsigned long) { return 0; }
  size_t print(double, int = 2) { return 0; }
  size_t println() { return 0; }
  size_t println(const char*) { return 0; }
  size_t println(char) { return 0; }
  int printf(const char*, ...) __attribute__((format(printf, 2, 3))) { return 0; }
};
extern SerialPort Serial;
