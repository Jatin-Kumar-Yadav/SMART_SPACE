#pragma once
#include "Arduino.h"
// Minimal shape of the ArduinoJson v7 calls the generated code makes.
struct JsonVariant {
  template <class T> JsonVariant& operator=(const T&) { return *this; }
  JsonVariant operator[](const char*) { return {}; }
  template <class T> T to() { return T(); }
};
struct JsonObject : JsonVariant {};
struct JsonDocument : JsonVariant {};
template <class T> T operator|(const JsonVariant&, T d) { return d; }
template <size_t N> size_t serializeJson(const JsonVariant&, char (&)[N]) { return 0; }
int deserializeJson(JsonDocument&, const char*, size_t) { return 0; }
