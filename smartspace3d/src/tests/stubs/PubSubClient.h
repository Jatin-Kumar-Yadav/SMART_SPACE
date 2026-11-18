#pragma once
#include "WiFi.h"
// signatures copied from PubSubClient 2.8
struct PubSubClient {
  PubSubClient(Client&) {}
  PubSubClient& setServer(const char*, uint16_t) { return *this; }
  PubSubClient& setCallback(void (*)(char*, uint8_t*, unsigned int)) { return *this; }
  bool setBufferSize(uint16_t) { return true; }
  boolean connected() { return false; }
  boolean connect(const char* id, const char* user, const char* pass, const char* willTopic, uint8_t willQos, boolean willRetain, const char* willMessage) { return false; }
  boolean subscribe(const char*) { return true; }
  boolean publish(const char* topic, const char* payload) { return true; }
  boolean publish(const char* topic, const char* payload, boolean retained) { return true; }
  boolean publish(const char* topic, const uint8_t* payload, unsigned int plength) { return true; }
  boolean publish(const char* topic, const uint8_t* payload, unsigned int plength, boolean retained) { return true; }
  boolean loop() { return true; }
};
