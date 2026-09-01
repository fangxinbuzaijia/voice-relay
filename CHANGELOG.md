# Changelog

All notable changes are documented here. The project follows Semantic Versioning.

## [1.0.0] - 2026-09-02

### Added

- Installable React PWA with device selection, local history, account management, and optional TOTP.
- Fastify relay server with SQLite account/session/device storage and no message persistence.
- Curve25519 sealed-box encryption between the browser and each Windows device.
- .NET 10 Windows tray client with Unicode clipboard paste, duplicate protection, automatic reconnect, pause, and startup-at-login.
- Zero-configuration account and master-key bootstrap in a persistent `data` directory.
- Docker Compose deployment that does not bind or configure ports 80/443.
- Automated CI plus tagged GHCR and Windows Release publishing.

### Fixed

- Allowed the WebAssembly execution mode required by `libsodium-wrappers` without enabling unrestricted script evaluation.
- Corrected the Windows `SendInput` native ABI layout that caused `Ctrl+V` submission to fail with an invalid-parameter error.
- Reworked the mobile UI into a calmer personal-tool design.

