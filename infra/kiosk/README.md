# Display device (reference build)

**Hardware:** a Raspberry Pi 5 (4 GB) with a 15.6" 1920×1080 capacitive USB-touch panel and a USB-C PD power supply.

1. Flash Raspberry Pi OS Lite (64-bit) and create the user `kinboard`.
2. Install the packages: `sudo apt install cage chromium-browser seatd`.
3. Copy `launch-chromium.sh` to `/opt/kinboard/` and `kinboard-kiosk.service` to `/etc/systemd/system/`, then set `KINBOARD_URL`.
4. Run `sudo systemctl set-default graphical.target && sudo systemctl enable --now kinboard-kiosk`.
5. Screen schedule (temporary until `kinboard-agent` ships): add a cron job that runs `wlr-randr --output HDMI-A-1 --off` / `--on`.

The production image (milestone M4) is a Yocto/RAUC A/B image with a read-only root filesystem. `kinboard-agent` handles pairing keys, screen schedule, brightness, and OTA updates. See spec §7.
