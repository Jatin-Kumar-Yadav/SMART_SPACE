#pragma once
#include "Arduino.h"
struct BH1750 { enum Mode { CONTINUOUS_HIGH_RES_MODE = 0x10 }; BH1750(uint8_t = 0x23) {} bool begin(Mode = CONTINUOUS_HIGH_RES_MODE, uint8_t = 0x23) { return true; } float readLightLevel() { return 0; } };
