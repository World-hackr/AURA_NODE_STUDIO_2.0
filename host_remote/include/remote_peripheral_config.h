#pragma once

#include <Arduino.h>

#include "remote_hardware_config.h"

namespace aura_host {
namespace remote_config {

constexpr int8_t kSpiSck = aura_remote::hardware::kSpiSck;
constexpr int8_t kSpiMiso = aura_remote::hardware::kSpiMiso;
constexpr int8_t kSpiMosi = aura_remote::hardware::kSpiMosi;

constexpr int8_t kPinRadioCe = aura_remote::hardware::kPinRadioCe;
constexpr int8_t kPinRadioCsn = aura_remote::hardware::kPinRadioCsn;
constexpr int8_t kPinRadioIrq = aura_remote::hardware::kPinRadioIrq;

// The old 1.8 inch build has no touch controller.
constexpr int8_t kPinTouchCs = -1;
constexpr int8_t kPinTouchIrq = -1;

constexpr int8_t kPinJoystickX = aura_remote::hardware::kPinJoystickX;
constexpr int8_t kPinJoystickY = aura_remote::hardware::kPinJoystickY;
constexpr int8_t kPinJoystickSwitch = aura_remote::hardware::kPinJoystickSwitch;
constexpr bool kJoystickSwitchActiveLow = aura_remote::hardware::kJoystickSwitchActiveLow;
constexpr bool kJoystickUpIsLow = aura_remote::hardware::kJoystickUpIsLow;
constexpr bool kJoystickLeftIsLow = aura_remote::hardware::kJoystickLeftIsLow;
constexpr int16_t kJoystickLowThreshold = aura_remote::hardware::kJoystickLowThreshold;
constexpr int16_t kJoystickHighThreshold = aura_remote::hardware::kJoystickHighThreshold;
constexpr uint16_t kJoystickInitialRepeatMs = 240;
constexpr uint16_t kJoystickRepeatMs = 140;
constexpr uint16_t kJoystickLongPressMs = aura_remote::hardware::kJoystickLongPressMs;
constexpr uint16_t kJoystickDebounceMs = aura_remote::hardware::kJoystickDebounceMs;

}  // namespace remote_config
}  // namespace aura_host

