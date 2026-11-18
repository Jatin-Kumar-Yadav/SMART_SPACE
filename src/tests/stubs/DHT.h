#pragma once
#include "Arduino.h"
#define DHT22 22
struct DHT { DHT(uint8_t, uint8_t) {} void begin() {} float readTemperature() { return 0; } float readHumidity() { return 0; } };
