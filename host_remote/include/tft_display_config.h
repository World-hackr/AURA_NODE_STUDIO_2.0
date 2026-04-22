#pragma once

#include <Arduino.h>

#include "remote_hardware_config.h"

namespace aura_host {
namespace display_config {

enum class PanelController : uint8_t {
  St7735 = 0,
  Ili9341 = 1,
};

constexpr int8_t kPinTftCs = aura_remote::hardware::kPinTftCs;
constexpr int8_t kPinTftDc = aura_remote::hardware::kPinTftDc;
constexpr int8_t kPinTftRst = aura_remote::hardware::kPinTftRst;
constexpr int8_t kPinTftBacklight = aura_remote::hardware::kPinTftBacklight;
constexpr bool kBacklightActiveLow = aura_remote::hardware::kBacklightActiveLow;

constexpr int8_t kSpiSck = aura_remote::hardware::kSpiSck;
constexpr int8_t kSpiMiso = aura_remote::hardware::kSpiMiso;
constexpr int8_t kSpiMosi = aura_remote::hardware::kSpiMosi;

constexpr PanelController kPanelController = PanelController::St7735;

constexpr uint16_t kPanelWidth = aura_remote::hardware::kTftWidth;
constexpr uint16_t kPanelHeight = aura_remote::hardware::kTftHeight;

// The old remote UI is designed around a 160x128 rotated canvas.
constexpr uint16_t kUiWidth = 160;
constexpr uint16_t kUiHeight = 128;
constexpr uint16_t kUiOriginX = 0;
constexpr uint16_t kUiOriginY = 0;

constexpr uint8_t kRotation = aura_remote::hardware::kTftRotation;
constexpr uint8_t kColumnOffset = aura_remote::hardware::kTftColumnOffset;
constexpr uint8_t kRowOffset = aura_remote::hardware::kTftRowOffset;

constexpr bool kUseBgrColorOrder = aura_remote::hardware::kTftUseBgrColorOrder;
constexpr bool kInvertColors = aura_remote::hardware::kTftInvertColors;

}  // namespace display_config
}  // namespace aura_host
