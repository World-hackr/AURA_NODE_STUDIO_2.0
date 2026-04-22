#pragma once

#include <Arduino.h>

enum class JoystickAction : uint8_t {
  None = 0,
  Up = 1,
  Down = 2,
  Left = 3,
  Right = 4,
  Select = 5,
  Home = 6,
};

struct JoystickSnapshot {
  int16_t rawX;
  int16_t rawY;
  bool switchPressed;
  bool switchLongActive;
  JoystickAction heldAction;
};

void initializeJoystickInput();
JoystickAction pollJoystickAction();
JoystickSnapshot readJoystickSnapshot();
