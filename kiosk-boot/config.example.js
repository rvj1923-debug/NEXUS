// Copy this file to kiosk-boot/config.js and set the KIOSK_DEVICE_SECRET from your .env file.
// kiosk-boot/config.js is gitignored so secrets are never committed.
window.CPT_KIOSK_CONFIG = {
  baseUrl: "http://localhost:5000",
  deviceKey: "REPLACE_WITH_KIOSK_DEVICE_SECRET_FROM_ENV",
};
window.KIOSK_DEVICE_SECRET = window.CPT_KIOSK_CONFIG.deviceKey;
