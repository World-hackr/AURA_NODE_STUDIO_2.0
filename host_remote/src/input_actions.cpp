#include "input_actions.h"

#include <algorithm>

#include "joystick_input.h"
#include "radio_self_test.h"
#include "remote_hardware_config.h"

namespace {

using namespace aura_remote::hardware;

constexpr uint8_t kBacklightPwmChannel = 0;
constexpr uint16_t kBacklightPwmFrequencyHz = 5000;
constexpr uint8_t kBacklightPwmResolutionBits = 8;
constexpr uint8_t kDefaultBacklightPercent = 75;

constexpr int16_t kCursorMinX = 12;
constexpr int16_t kCursorMaxX = 148;
constexpr int16_t kCursorMinY = 28;
constexpr int16_t kCursorMaxY = 104;

bool backlightPwmReady = false;

bool valueChangedEnough(int16_t previous, int16_t next, int16_t threshold) {
  return abs(previous - next) >= threshold;
}

template <typename T>
T clampValue(T value, T minValue, T maxValue) {
  if (value < minValue) {
    return minValue;
  }

  if (value > maxValue) {
    return maxValue;
  }

  return value;
}

void initializeBacklightPwm() {
  if ((kPinTftBacklight < 0) || backlightPwmReady) {
    return;
  }

  ledcSetup(kBacklightPwmChannel, kBacklightPwmFrequencyHz, kBacklightPwmResolutionBits);
  ledcAttachPin(kPinTftBacklight, kBacklightPwmChannel);
  backlightPwmReady = true;
}

void applyBacklightPercent(uint8_t percent) {
  if (kPinTftBacklight < 0) {
    return;
  }

  initializeBacklightPwm();

  const uint32_t maxDuty = (1u << kBacklightPwmResolutionBits) - 1u;
  uint32_t duty = (static_cast<uint32_t>(percent) * maxDuty) / 100u;
  if (kBacklightActiveLow) {
    duty = maxDuty - duty;
  }

  ledcWrite(kBacklightPwmChannel, duty);
}

void storeRadioTestResult(AppState& state, RadioSelfTestState result) {
  result.runCount = static_cast<uint16_t>(state.radioTest.runCount + 1);
  state.radioTest = result;
  state.needsRender = true;
}

void runRadioTest(AppState& state) {
  storeRadioTestResult(state, runRadioSelfTest());
}

void openSelectedScreen(AppState& state) {
  switch (state.selectionIndex) {
    case 0:
      setScreen(state, HostScreen::PhoneSync);
      break;
    case 1:
      state.radioReturnScreen = HostScreen::Home;
      setScreen(state, HostScreen::Radio);
      break;
    case 2:
      setScreen(state, HostScreen::InventoryAdjust);
      break;
    case 3:
      setScreen(state, HostScreen::NodesList);
      break;
    default:
      goHome(state);
      break;
  }
}

void adjustBacklight(AppState& state, int delta) {
  const int next = clampValue<int>(static_cast<int>(state.backlightPercent) + delta, 0, 100);
  if (next == state.backlightPercent) {
    return;
  }

  state.backlightPercent = static_cast<uint8_t>(next);
  applyBacklightPercent(state.backlightPercent);
  state.needsRender = true;
}

int16_t axisStep(int16_t rawValue, bool lowIsNegative) {
  if (rawValue < kJoystickLowThreshold) {
    return lowIsNegative ? -2 : 2;
  }

  if (rawValue > kJoystickHighThreshold) {
    return lowIsNegative ? 2 : -2;
  }

  return 0;
}

void updateCursor(AppState& state, const JoystickSnapshot& snapshot) {
  const int16_t deltaX = axisStep(snapshot.rawX, kJoystickLeftIsLow);
  const int16_t deltaY = axisStep(snapshot.rawY, kJoystickUpIsLow);

  const int16_t nextX =
      clampValue<int16_t>(static_cast<int16_t>(state.joystickCursorX + deltaX), kCursorMinX, kCursorMaxX);
  const int16_t nextY =
      clampValue<int16_t>(static_cast<int16_t>(state.joystickCursorY + deltaY), kCursorMinY, kCursorMaxY);

  if ((nextX != state.joystickCursorX) || (nextY != state.joystickCursorY)) {
    state.joystickCursorX = nextX;
    state.joystickCursorY = nextY;
    state.needsRender = true;
  }
}

void updateJoystickTelemetry(AppState& state) {
  const JoystickSnapshot snapshot = readJoystickSnapshot();

  const bool rawChanged = valueChangedEnough(state.joystickRawX, snapshot.rawX, 10) ||
                          valueChangedEnough(state.joystickRawY, snapshot.rawY, 10);
  const bool switchChanged = (state.joystickSwitchPressed != snapshot.switchPressed) ||
                             (state.joystickSwitchLongActive != snapshot.switchLongActive);
  const bool actionChanged = state.joystickHeldAction != snapshot.heldAction;

  state.joystickRawX = snapshot.rawX;
  state.joystickRawY = snapshot.rawY;
  state.joystickSwitchPressed = snapshot.switchPressed;
  state.joystickSwitchLongActive = snapshot.switchLongActive;
  state.joystickHeldAction = snapshot.heldAction;

  if (state.screen == HostScreen::PhoneSync) {
    updateCursor(state, snapshot);
  }

  if (rawChanged || switchChanged || actionChanged) {
    state.needsRender = true;
  }
}

void handleHomeAction(AppState& state, JoystickAction action) {
  switch (action) {
    case JoystickAction::Up:
    case JoystickAction::Left:
      moveSelection(state, -1);
      break;
    case JoystickAction::Down:
    case JoystickAction::Right:
      moveSelection(state, 1);
      break;
    case JoystickAction::Select:
      openSelectedScreen(state);
      break;
    case JoystickAction::Home:
    case JoystickAction::None:
      break;
  }
}

void handleRadioAction(AppState& state, JoystickAction action) {
  switch (action) {
    case JoystickAction::Up:
    case JoystickAction::Down:
      moveSelection(state, state.selectionIndex == 0 ? 1 : -1);
      break;
    case JoystickAction::Right:
    case JoystickAction::Select:
      if (state.selectionIndex == 0) {
        runRadioTest(state);
      } else {
        goHome(state);
      }
      break;
    case JoystickAction::Left:
    case JoystickAction::Home:
      goHome(state);
      break;
    case JoystickAction::None:
      break;
  }
}

void handleJoystickAction(AppState& state, JoystickAction action) {
  switch (action) {
    case JoystickAction::Select:
      state.joystickCursorX = 80;
      state.joystickCursorY = 64;
      state.needsRender = true;
      break;
    case JoystickAction::Left:
    case JoystickAction::Home:
      goHome(state);
      break;
    case JoystickAction::Up:
    case JoystickAction::Down:
    case JoystickAction::Right:
    case JoystickAction::None:
      break;
  }
}

void handleBacklightAction(AppState& state, JoystickAction action) {
  switch (action) {
    case JoystickAction::Up:
    case JoystickAction::Right:
      adjustBacklight(state, 5);
      break;
    case JoystickAction::Down:
    case JoystickAction::Left:
      adjustBacklight(state, -5);
      break;
    case JoystickAction::Select:
      state.backlightPercent = (state.backlightPercent < 50) ? 100 : 30;
      applyBacklightPercent(state.backlightPercent);
      state.needsRender = true;
      break;
    case JoystickAction::Home:
      goHome(state);
      break;
    case JoystickAction::None:
      break;
  }
}

void handlePinsAction(AppState& state, JoystickAction action) {
  switch (action) {
    case JoystickAction::Left:
    case JoystickAction::Select:
    case JoystickAction::Home:
      goHome(state);
      break;
    case JoystickAction::Up:
    case JoystickAction::Down:
    case JoystickAction::Right:
    case JoystickAction::None:
      break;
  }
}

void handleAction(AppState& state, JoystickAction action) {
  switch (state.screen) {
    case HostScreen::Home:
      handleHomeAction(state, action);
      break;
    case HostScreen::Radio:
      handleRadioAction(state, action);
      break;
    case HostScreen::PhoneSync:
      handleJoystickAction(state, action);
      break;
    case HostScreen::InventoryAdjust:
      handleBacklightAction(state, action);
      break;
    case HostScreen::NodesList:
      handlePinsAction(state, action);
      break;
    default:
      goHome(state);
      break;
  }
}

}  // namespace

void initializeInputActions() {
  initializeJoystickInput();
  initializeBacklightPwm();
  applyBacklightPercent(kDefaultBacklightPercent);
}

void pollInputActions(AppState& state) {
  updateJoystickTelemetry(state);

  const JoystickAction action = pollJoystickAction();
  if (action != JoystickAction::None) {
    handleAction(state, action);
  }
}
