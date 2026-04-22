#include <Arduino.h>

#include "remote_hardware_config.h"

namespace {

using namespace aura_remote::hardware;

enum class Direction : uint8_t {
  None = 0,
  Up,
  Down,
  Left,
  Right,
};

bool switchPressed = false;
bool longPressFired = false;
unsigned long switchChangedAt = 0;
unsigned long switchPressedAt = 0;
unsigned long lastPrintAt = 0;

Direction detectDirection(int16_t rawX, int16_t rawY) {
  const bool xLow = rawX < kJoystickLowThreshold;
  const bool xHigh = rawX > kJoystickHighThreshold;
  const bool yLow = rawY < kJoystickLowThreshold;
  const bool yHigh = rawY > kJoystickHighThreshold;

  if (kJoystickUpIsLow) {
    if (yLow) return Direction::Up;
    if (yHigh) return Direction::Down;
  } else {
    if (yHigh) return Direction::Up;
    if (yLow) return Direction::Down;
  }

  if (kJoystickLeftIsLow) {
    if (xLow) return Direction::Left;
    if (xHigh) return Direction::Right;
  } else {
    if (xHigh) return Direction::Left;
    if (xLow) return Direction::Right;
  }

  return Direction::None;
}

const __FlashStringHelper* directionLabel(Direction direction) {
  switch (direction) {
    case Direction::Up: return F("UP");
    case Direction::Down: return F("DOWN");
    case Direction::Left: return F("LEFT");
    case Direction::Right: return F("RIGHT");
    case Direction::None: return F("CENTER");
  }
  return F("CENTER");
}

bool rawSwitchPressed() {
  const int raw = digitalRead(kPinJoystickSwitch);
  return kJoystickSwitchActiveLow ? (raw == LOW) : (raw == HIGH);
}

void printSwitchEvent(const __FlashStringHelper* label) {
  Serial.print(F("Switch event: "));
  Serial.println(label);
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(250);

  pinMode(kPinJoystickSwitch, kJoystickSwitchActiveLow ? INPUT_PULLUP : INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(kPinJoystickX, ADC_11db);
  analogSetPinAttenuation(kPinJoystickY, ADC_11db);

  switchPressed = rawSwitchPressed();
  switchChangedAt = millis();
  switchPressedAt = switchChangedAt;

  Serial.println();
  Serial.println(F("AURA Remote joystick smoke test"));
  Serial.print(F("X/Y/SW pins: "));
  Serial.print(kPinJoystickX);
  Serial.print(F(" / "));
  Serial.print(kPinJoystickY);
  Serial.print(F(" / "));
  Serial.println(kPinJoystickSwitch);
}

void loop() {
  const unsigned long now = millis();
  const int16_t rawX = static_cast<int16_t>(analogRead(kPinJoystickX));
  const int16_t rawY = static_cast<int16_t>(analogRead(kPinJoystickY));
  const Direction direction = detectDirection(rawX, rawY);

  const bool currentPressed = rawSwitchPressed();
  if (currentPressed != switchPressed) {
    if ((now - switchChangedAt) >= kJoystickDebounceMs) {
      switchPressed = currentPressed;
      switchChangedAt = now;
      if (switchPressed) {
        switchPressedAt = now;
        longPressFired = false;
        printSwitchEvent(F("PRESS"));
      } else if (!longPressFired) {
        printSwitchEvent(F("SHORT"));
      }
    }
  }

  if (switchPressed && !longPressFired && ((now - switchPressedAt) >= kJoystickLongPressMs)) {
    longPressFired = true;
    printSwitchEvent(F("LONG"));
  }

  if ((now - lastPrintAt) >= 120) {
    lastPrintAt = now;
    Serial.print(F("X="));
    Serial.print(rawX);
    Serial.print(F(" Y="));
    Serial.print(rawY);
    Serial.print(F(" DIR="));
    Serial.print(directionLabel(direction));
    Serial.print(F(" SW="));
    Serial.println(currentPressed ? F("PRESSED") : F("RELEASED"));
  }
}
