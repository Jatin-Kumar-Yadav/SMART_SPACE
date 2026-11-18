#pragma once
#include "Arduino.h"
struct Adafruit_PWMServoDriver { Adafruit_PWMServoDriver(uint8_t = 0x40) {} void begin() {} void setPWMFreq(float) {} uint8_t setPWM(uint8_t, uint16_t, uint16_t) { return 0; } };
