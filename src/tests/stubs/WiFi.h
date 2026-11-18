#pragma once
#include "Arduino.h"
#define WL_CONNECTED 3
struct Client {};
struct WiFiClient : Client {};
struct WiFiClass { void begin(const char*, const char*, int = 0) {} int status() { return 0; } };
extern WiFiClass WiFi;
