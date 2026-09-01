# Verification Record

## Automated coverage

- Protocol: versioned frame validation and UTF-16 code-unit counting.
- Server: Argon2id with an eight-character minimum, persistent/generated/legacy master keys, exact eight-character bootstrap credentials, encrypted optional TOTP storage, old-schema migration, private-proxy and dynamic Origin/Host validation, login limiting, exact database table set, and live smoke paths.
- PWA: sealed-box round trip, IndexedDB 100-entry/30-day pruning, and TOFU fingerprint persistence.
- Windows: browser-generated sealed-box fixed vector, tamper rejection, DPAPI round trip, duplicate-ID persistence, quoted startup command, Release build, and self-contained x64 single-file publish.
- Windows executable: verified a single 55.6 MiB `VoiceRelay.exe`, embedded multi-resolution brand icon, `Voice Relay` product/version metadata, and actual close-to-notification-area behavior where the visible settings window closed while the process remained running. The notification-area right-click menu remains a manual click check because the desktop automation surface cannot target the Windows taskbar.
- Live relay smoke: health, untrusted Origin rejection, password/TOTP login, refresh rotation and replay rejection, registration, presence, delivery/ACK, duplicate pending ID, five-second unknown result, pause, offline rejection, and revoke.
- Live account smoke: automatic account initialization, password-only login while TOTP is disabled, standard `otpauth://` setup, six-digit confirmation, credential change, initial-file removal, current-session retention, and `totp_required` after enablement.
- Build gates: full workspace type-check/test/build and .NET 10 Release tests passed locally. CI additionally builds the image, starts Compose without `.env`, validates both eight-character credentials, and rejects 80/443 mappings.
- Browser WebAssembly CSP repair: server and PWA tests, server type-check, and the production PWA build passed. A live response returned `script-src 'self' 'wasm-unsafe-eval'` without general `unsafe-eval`; in the in-app Chromium browser the production PWA rendered, libsodium initialized under that policy, reported Sodium 1.0.22, and produced no browser warnings or errors.
- Windows `SendInput` repair: the managed `INPUT` ABI regression test confirms 40 bytes on x64, all six Windows tests passed, and version 0.1.1 was published as a self-contained compressed single-file x64 executable. The previous 32-byte structure omitted the larger native mouse union member and caused Win32 error 87 before Ctrl+V could be submitted.
- Fresh PWA redesign: web type-check, all three PWA tests, production build, and the color/font/icon design audits passed. Browser checks at a 390×844 viewport covered login, send, device/session, and account-security views; the layouts remained readable without horizontal overflow and the final production pages produced no console warnings or errors.

## Manual release matrix

The following checks require physical target environments and remain release-time checks rather than automated claims:

- Actual clipboard paste into representative programs on Windows 10 LTSC and Windows 11, including Chinese, emoji, tabs, multiline and 10,000 UTF-16 units.
- Locked desktop, clipboard contention, focus switching, held modifiers, elevated target and client-exit behavior.
- Android Chrome and iPhone Safari installed-PWA behavior with each platform's system voice keyboard.
- A deployment behind the user's representative external HTTPS/WebSocket reverse proxy.
- Inno Setup compilation and manual overlay-upgrade behavior on a clean per-user Windows installation.

The local in-app browser controller was unavailable during this implementation run because its runtime assets could not be initialized (`failed to write kernel assets: path not found`). The production PWA was still type-checked, unit-tested, built, served by the real application, and exercised through its backing account API; interactive visual inspection remains in the manual matrix.
