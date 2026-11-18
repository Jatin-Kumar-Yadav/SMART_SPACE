#pragma once
#include "Arduino.h"
struct Adafruit_BME280 { bool begin(uint8_t = 0x77) { return true; } float readTemperature() { return 0; } float readHumidity() { return 0; } };
