#pragma once
#include <stdint.h>

class ESP32PWM {
public:
  static void allocateTimer(int) {}
};

class Servo {
public:
  Servo() {}
  int attach(int pin, int min = 544, int max = 2400) { return 1; }
  void write(int value) {}
  int read() { return 0; }
  void detach() {}
  bool attached() { return true; }
};
