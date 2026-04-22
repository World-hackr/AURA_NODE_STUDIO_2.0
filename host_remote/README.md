# AURA Remote

This folder is an isolated firmware work area for the old handheld host remote
hardware.

It is intentionally separate from the current Studio app so display, radio, and
joystick bring-up can be tested without dragging firmware concerns into the
Studio-only product surface.

## Current Hardware Map

The pin map in this folder is based on the older remote wiring you confirmed:

### 1.8 inch ST7735 display

- `VCC -> 3V3`
- `GND -> GND`
- `SCL/CLK -> GPIO18`
- `SDA/MOSI -> GPIO23`
- `CS -> GPIO5`
- `DC/A0 -> GPIO27`
- `RES/RST -> GPIO26`
- `LED/BLK -> AO3407 drain`

### AO3407 backlight switch

- `AO3407 source -> 3V3`
- `AO3407 drain -> TFT LED/BLK`
- `AO3407 gate -> GPIO21`
- `150 ohm` resistor in series between `GPIO21` and the gate
- `100k` resistor from gate to source

This path is active-low from firmware. `LOW` at `GPIO21` turns the backlight
on.

### nRF24L01

- `VCC -> 3.3V`
- `GND -> GND`
- `SCK -> GPIO18`
- `MOSI -> GPIO23`
- `MISO -> GPIO19`
- `CE -> GPIO4`
- `CSN -> GPIO16`
- `IRQ -> not used`

Add local decoupling near the radio:

- `10uF to 47uF` across `VCC` and `GND`
- `0.1uF` ceramic across `VCC` and `GND`

### Joystick

- `VCC -> 3V3`
- `GND -> GND`
- `VRx -> GPIO33`
- `VRy -> GPIO32`
- `SW -> GPIO25`

## Integrated Root Firmware

The root firmware at `host_remote/src/main.cpp` is now the main bring-up image.

What it does:

- runs the nRF24 self-test once on boot
- shows live radio status on the TFT
- gives a joystick test screen where the stick moves an on-screen box
- gives a backlight PWM test screen for the `GPIO21 -> AO3407` path
- shows a compact pin-map screen on-device

Home-screen options:

- `Joystick`
- `Radio`
- `Backlight`
- `Pins`

Controls:

- home: `up/down` browse, `press` open
- joystick screen: move the stick to move the box, `press` recenters, `hold press` goes home
- radio screen: `up/down` choose `run self test` or `back`, `press` selects
- backlight screen: `left/right` or `up/down` changes PWM brightness, `press` jumps between presets, `hold press` goes home
- pins screen: `press` or `left` goes home

Build and upload:

```powershell
C:\Users\Santo\.platformio\penv\Scripts\pio.exe run -d host_remote -t upload
C:\Users\Santo\.platformio\penv\Scripts\pio.exe device monitor -d host_remote -b 115200
```

## Standalone Smoke Tests

- `tests/display_st7735_smoke/`
  Raw SPI color and orientation test for the old 1.8 inch LCD using the real
  backlight control pin.
- `tests/nrf24_pin_smoke/`
  Single-radio SPI and CE verification test.
- `tests/joystick_smoke/`
  Raw axis and switch test with interpreted direction output.
