#pragma once
#include "Arduino.h"
struct TwoWire { void begin() {} void begin(int, int) {} void beginTransmission(uint8_t) {} size_t write(uint8_t) { return 1; } uint8_t endTransmission() { return 0; } };
extern TwoWire Wire;
