#pragma once

#include <Arduino.h>

namespace aura_remote {
namespace hardware {

constexpr int8_t kSpiSck = 18;
constexpr int8_t kSpiMiso = 19;
constexpr int8_t kSpiMosi = 23;

constexpr int8_t kPinTftCs = 5;
constexpr int8_t kPinTftDc = 27;
constexpr int8_t kPinTftRst = 26;
constexpr int8_t kPinTftBacklight = 21;
constexpr bool kBacklightActiveLow = true;
constexpr uint16_t kTftWidth = 128;
constexpr uint16_t kTftHeight = 160;
constexpr uint8_t kTftRotation = 1;
constexpr uint8_t kTftColumnOffset = 0;
constexpr uint8_t kTftRowOffset = 0;
constexpr bool kTftUseBgrColorOrder = true;
constexpr bool kTftInvertColors = false;

constexpr int8_t kPinRadioCe = 4;
constexpr int8_t kPinRadioCsn = 16;
constexpr int8_t kPinRadioIrq = -1;

constexpr int8_t kPinJoystickX = 33;
constexpr int8_t kPinJoystickY = 32;
constexpr int8_t kPinJoystickSwitch = 25;
constexpr bool kJoystickSwitchActiveLow = true;
constexpr bool kJoystickUpIsLow = true;
constexpr bool kJoystickLeftIsLow = true;
constexpr int16_t kJoystickLowThreshold = 1400;
constexpr int16_t kJoystickHighThreshold = 2700;
constexpr uint16_t kJoystickLongPressMs = 700;
constexpr uint16_t kJoystickDebounceMs = 30;

}  // namespace hardware
}  // namespace aura_remote
