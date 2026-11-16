#pragma once
#include "Arduino.h"
struct Adafruit_ADS1115 { bool begin(uint8_t = 0x48) { return true; } int16_t readADC_SingleEnded(uint8_t) { return 0; } };
