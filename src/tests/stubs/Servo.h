#pragma once
#include <stdint.h>

class Servo {
public:
  Servo() {}
  uint8_t attach(int pin) { return 1; }
  void write(int value) {}
  int read() { return 0; }
  void detach() {}
  bool attached() { return true; }
};
