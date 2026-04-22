#include "ui_screen.h"

#include <stdio.h>

namespace {

const char* screenLabel(HostScreen screen) {
  switch (screen) {
    case HostScreen::Home:
      return "Dashboard";
    case HostScreen::PhoneSync:
      return "Joystick";
    case HostScreen::Radio:
      return "Radio";
    case HostScreen::InventoryAdjust:
      return "Backlight";
    case HostScreen::NodesList:
      return "Pins";
    default:
      return "Dashboard";
  }
}

const char* radioOverallLabel(const RadioSelfTestState& radioTest) {
  if (!radioTest.hasRun) {
    return "NOT RUN";
  }

  if (radioTest.spiLooksAlive && radioTest.writeReadbackPass && radioTest.ceTriggerPass) {
    return "PASS";
  }

  if (!radioTest.spiLooksAlive || !radioTest.writeReadbackPass) {
    return "FAIL";
  }

  return "PARTIAL";
}

void printItem(bool selected, const __FlashStringHelper* label) {
  Serial.print(selected ? F("> ") : F("  "));
  Serial.println(label);
}

void renderHome(const AppState& state) {
  Serial.print(F("Radio: "));
  Serial.print(radioOverallLabel(state.radioTest));
  Serial.print(F("  Backlight: "));
  Serial.print(state.backlightPercent);
  Serial.println(F("%"));
  Serial.println(F("Select a test:"));
  printItem(state.selectionIndex == 0, F("Joystick"));
  printItem(state.selectionIndex == 1, F("Radio"));
  printItem(state.selectionIndex == 2, F("Backlight"));
  printItem(state.selectionIndex == 3, F("Pins"));
}

void renderJoystick(const AppState& state) {
  Serial.print(F("Raw X/Y: "));
  Serial.print(state.joystickRawX);
  Serial.print(F(" / "));
  Serial.println(state.joystickRawY);
  Serial.print(F("Held: "));
  Serial.println(joystickActionLabel(state.joystickHeldAction));
  Serial.print(F("Switch: "));
  Serial.println(state.joystickSwitchPressed ? F("PRESSED") : F("RELEASED"));
  Serial.print(F("Long press: "));
  Serial.println(state.joystickSwitchLongActive ? F("ACTIVE") : F("IDLE"));
  Serial.print(F("Cursor: "));
  Serial.print(state.joystickCursorX);
  Serial.print(F(", "));
  Serial.println(state.joystickCursorY);
  Serial.println(F("Move stick to move the on-screen marker."));
  Serial.println(F("Press to center. Hold press to go home."));
}

void renderRadio(const AppState& state) {
  const RadioSelfTestState& radioTest = state.radioTest;
  Serial.print(F("Overall: "));
  Serial.println(radioOverallLabel(radioTest));
  Serial.print(F("Runs: "));
  Serial.println(radioTest.runCount);
  Serial.print(F("SPI alive: "));
  Serial.println(radioTest.spiLooksAlive ? F("PASS") : F("FAIL"));
  Serial.print(F("Write/readback: "));
  Serial.println(radioTest.writeReadbackPass ? F("PASS") : F("FAIL"));
  Serial.print(F("CE trigger: "));
  Serial.println(radioTest.ceTriggerPass ? F("PASS") : F("FAIL"));
  Serial.print(F("Status: 0x"));
  Serial.println(radioTest.status, HEX);
  Serial.print(F("ObserveTx: 0x"));
  Serial.println(radioTest.observeTx, HEX);
  printItem(state.selectionIndex == 0, F("Run self test"));
  printItem(state.selectionIndex == 1, F("Back home"));
}

void renderBacklight(const AppState& state) {
  Serial.print(F("Backlight PWM: "));
  Serial.print(state.backlightPercent);
  Serial.println(F("%"));
  Serial.println(F("UP/RIGHT = brighter"));
  Serial.println(F("DOWN/LEFT = dimmer"));
  Serial.println(F("PRESS = jump preset"));
  Serial.println(F("HOLD PRESS = home"));
}

void renderPins() {
  Serial.println(F("Display  CLK 18  MOSI 23  CS 5  DC 27  RST 26"));
  Serial.println(F("Backlight gate GPIO21 via AO3407"));
  Serial.println(F("NRF24   SCK 18 MOSI 23 MISO 19 CE 4 CSN 16"));
  Serial.println(F("Joystick VRx 33 VRy 32 SW 25"));
  Serial.println(F("3V3 powers display, nRF24, joystick"));
  Serial.println(F("PRESS or LEFT = home"));
}

void printControls(const AppState& state) {
  Serial.println();
  switch (state.screen) {
    case HostScreen::Home:
      Serial.println(F("Joystick: UP/DOWN browse  PRESS open"));
      break;
    case HostScreen::PhoneSync:
      Serial.println(F("Joystick: move marker  PRESS recenter  HOLD home"));
      break;
    case HostScreen::Radio:
      Serial.println(F("Joystick: UP/DOWN select  PRESS run/back  LEFT home"));
      break;
    case HostScreen::InventoryAdjust:
      Serial.println(F("Joystick: LEFT/RIGHT or UP/DOWN adjust PWM  HOLD home"));
      break;
    case HostScreen::NodesList:
      Serial.println(F("Joystick: PRESS or LEFT home"));
      break;
    default:
      break;
  }
}

}  // namespace

void renderScreen(const AppState& state) {
  Serial.println();
  Serial.println(F("========================================"));
  Serial.print(F("AURA Remote Test :: "));
  Serial.println(screenLabel(state.screen));
  Serial.println(F("========================================"));

  switch (state.screen) {
    case HostScreen::Home:
      renderHome(state);
      break;
    case HostScreen::PhoneSync:
      renderJoystick(state);
      break;
    case HostScreen::Radio:
      renderRadio(state);
      break;
    case HostScreen::InventoryAdjust:
      renderBacklight(state);
      break;
    case HostScreen::NodesList:
      renderPins();
      break;
    default:
      renderHome(state);
      break;
  }

  printControls(state);
}
