#pragma once
#include "OneWire.h"
typedef uint8_t DeviceAddress[8];
#define DEVICE_DISCONNECTED_C -127.0f
struct DallasTemperature { DallasTemperature(OneWire*) {} void begin() {} int getDeviceCount() { return 0; } bool getAddress(uint8_t*, uint8_t) { return false; } void requestTemperatures() {} float getTempCByIndex(uint8_t) { return 0; } };
