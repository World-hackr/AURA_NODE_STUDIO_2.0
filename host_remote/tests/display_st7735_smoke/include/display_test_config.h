#pragma once

#include <Arduino.h>

#include "remote_hardware_config.h"

namespace display_test {

constexpr int8_t kPinTftCs = aura_remote::hardware::kPinTftCs;
constexpr int8_t kPinTftDc = aura_remote::hardware::kPinTftDc;
constexpr int8_t kPinTftRst = aura_remote::hardware::kPinTftRst;
constexpr int8_t kPinTftBacklight = aura_remote::hardware::kPinTftBacklight;
constexpr bool kBacklightActiveLow = aura_remote::hardware::kBacklightActiveLow;

constexpr int8_t kPinRadioCe = aura_remote::hardware::kPinRadioCe;
constexpr int8_t kPinRadioCsn = aura_remote::hardware::kPinRadioCsn;

constexpr int8_t kSpiSck = aura_remote::hardware::kSpiSck;
constexpr int8_t kSpiMiso = aura_remote::hardware::kSpiMiso;
constexpr int8_t kSpiMosi = aura_remote::hardware::kSpiMosi;

constexpr uint16_t kPanelWidth = aura_remote::hardware::kTftWidth;
constexpr uint16_t kPanelHeight = aura_remote::hardware::kTftHeight;
constexpr uint8_t kRotation = aura_remote::hardware::kTftRotation;
constexpr uint8_t kColumnOffset = aura_remote::hardware::kTftColumnOffset;
constexpr uint8_t kRowOffset = aura_remote::hardware::kTftRowOffset;
constexpr bool kUseBgrColorOrder = aura_remote::hardware::kTftUseBgrColorOrder;
constexpr bool kInvertColors = aura_remote::hardware::kTftInvertColors;

}  // namespace display_test

