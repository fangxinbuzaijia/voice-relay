# Mobile Voice Relay Design

## Architecture

The React PWA and .NET tray client authenticate with the Fastify service over REST and maintain a versioned WebSocket connection. The server stores only one user, sessions, and registered devices in SQLite. Online state and pending acknowledgements stay in process memory.

The application exposes static PWA files, `/api/v1`, `/ws`, and health endpoints on one internal HTTP port. Existing user-managed infrastructure terminates TLS and proxies a dedicated host to this port. Browser Origin validation compares the supplied Origin to the proxy-preserved Host dynamically; no public origin setting is required.

## Zero-configuration bootstrap

Compose bind-mounts `./data` at `/data` and maps `127.0.0.1:3100` to container port 3000. On first startup the service atomically creates `/data/master.key`, migrates SQLite, and creates the single disabled-TOTP bootstrap account. Its eight-character alphanumeric username and password are written to `/data/initial-credentials.txt` with owner-only permissions and printed only during that initialization run. Existing data without a recoverable master key is a hard startup error.

## Security

- Passwords use Argon2id with an eight-character minimum. TOTP is optional and disabled on the bootstrap account. TOTP secrets use AES-256-GCM under the persistent 32-byte server master key.
- Opaque access and refresh tokens are random; only SHA-256 hashes are stored. Browser refresh tokens use Secure, HttpOnly, SameSite=Strict cookies; Windows secrets use DPAPI CurrentUser.
- Each Windows device owns a Curve25519 key pair. The PWA uses libsodium sealed boxes and records a TOFU fingerprint in IndexedDB.
- The static PWA response permits the narrowly scoped CSP source expression `wasm-unsafe-eval`, which libsodium requires to instantiate its WebAssembly module, without permitting general `unsafe-eval`.
- Message payloads are never persisted or logged. The server validates ownership, presence, timestamp, and size before forwarding ciphertext.
- This protects confidentiality from an honest-but-curious relay. A malicious relay that knows a device public key can still forge a new sealed message; first-use server compromise is outside the v1 threat model.

## Protocol and data

REST provides login/refresh/logout, session revocation, device registration/list/rename/revoke, account inspection, credential changes, and TOTP setup/confirm/disable. WebSocket frames use protocol version 1 and the event types `auth`, `heartbeat`, `presence.snapshot`, `presence.changed`, `text.send`, `text.deliver`, `text.ack`, and `error`.

SQLite tables remain `users`, `sessions`, and `devices`; the user row also stores TOTP enabled/pending state and bootstrap-credential state. No messages table exists. WebSocket heartbeats run every 20 seconds and a device becomes offline after 45 seconds. Sends accept at most 10,000 UTF-16 code units and a 30-second clock skew.

## Windows injection

The client runs in the interactive user session. It performs focus, modifier, lock, and integrity checks; retries clipboard acquisition for one second; writes Unicode text; verifies the foreground window is unchanged; and calls `SendInput` for Ctrl+V. The received text remains on the clipboard. A successful acknowledgement means only that the clipboard write and input submission succeeded.

## Windows packaging and lifecycle

The WinForms client publishes as a self-contained x64 single-file `VoiceRelay.exe`. The executable, dialogs, notification-area icon, shortcuts, and installer reuse the PWA brand mark through a multi-resolution Windows icon. The `ApplicationContext` owns the process lifetime: closing configuration or login dialogs returns the app to the notification area, while only the notification-area `退出` command ends the process. A checked menu item manages the current-user Run registry entry and reports registry failures without crashing.

## Interface design

- Purpose: make target selection, dictation review, and delivery status usable in seconds with one hand, while feeling like a private everyday utility rather than a commercial product.
- Direction: organic/natural with a restrained personal-note character.
- Palette: mist `#F3F8F6`, paper `#FCFEFD`, pine `#29433A`, sage `#7FA58D`, apricot `#E6AD7E`, plus a muted brick red only for errors.
- Typography: Noto Sans SC for headings and body text; IBM Plex Mono is limited to counts, identifiers, and timestamps.
- Layout: offset device rail, dominant paper-like editor, thumb-zone action bar, and an overlapping history drawer. The login view uses a single animated phone-to-computer trace as its signature. Lucide remains the only icon set.
- Copy uses direct Chinese action labels and removes numbered sections, uppercase technical slogans, and marketing-style claims.
- Account security uses the same soft surfaces and single-column mobile forms without interrupting the primary send flow.
