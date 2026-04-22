# AURA Remote Tests

Each test is isolated and should be opened or built separately.

Current tests:

- `display_st7735_smoke/`
  Confirms the old 1.8 inch ST7735 panel and AO3407 backlight path.
- `nrf24_pin_smoke/`
  Confirms SPI wiring and CE behavior for one radio.
- `joystick_smoke/`
  Confirms both joystick axes and the push switch.

These tests all assume the shared hardware map in:

- `host_remote/include/remote_hardware_config.h`

