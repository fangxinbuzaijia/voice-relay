# Mobile Voice Relay Requirements

## Problem and scope

The user relies on mobile voice-to-text but needs the resulting text in the currently focused input on one of several remote Windows computers. The first release is a single-account system composed of a mobile PWA, an opaque cloud relay, and a per-user Windows tray client.

## User stories

1. As the account owner, I want to sign in with a password and optional TOTP so that only my authorized sessions can send or receive text.
2. As a mobile user, I want to see named computers and their live state so that I can choose exactly one target.
3. As a mobile user, I want to dictate, edit, and send plain text so that it is pasted into the focused Windows input.
4. As the account owner, I want relay traffic encrypted for the selected computer so that the server does not receive message plaintext.
5. As a Windows user, I want a tray client that starts with my session and can be paused, renamed, reconfigured, or signed out.

## Acceptance criteria

1. When a valid username and password are submitted, the system shall create a revocable session with a 15-minute access token and rotating 30-day refresh token; when TOTP is enabled, it shall additionally require a valid six-digit code.
2. When a mobile session connects, the system shall show all non-revoked computers with stable IDs, names, public keys, and online/offline/paused states.
3. When an online, unpaused target is selected and text is submitted, the PWA shall encrypt a versioned payload for that device and the relay shall forward only the ciphertext.
4. When a target is offline or paused, the relay shall reject the send immediately and shall not persist or queue the payload.
5. When the Windows client decrypts a valid, fresh, non-duplicate message, it shall place the exact Unicode plain text on the clipboard and submit one Ctrl+V input sequence without appending Enter.
6. When the foreground window changes, the desktop is locked, a modifier is held, the target has greater integrity, or the clipboard remains unavailable for one second, the Windows client shall not paste and shall return a specific failure status.
7. When an acknowledgement is not received within five seconds, the PWA shall show an unknown result and shall not retry automatically.
8. When a device public key differs from the first trusted fingerprint, the PWA shall block sending until the user explicitly trusts the replacement.
9. When a send succeeds, the PWA shall retain it only in local IndexedDB, capped at 100 entries and 30 days; the server shall have no message table.
10. While deployed, the application container shall listen on port 3000 and map by default only to 127.0.0.1:3100; it shall not bind ports 80 or 443 or manage TLS.
11. When an empty persistent data directory is started, the service shall create a persistent 32-byte master key and one account whose username and password are each exactly eight cryptographically random alphanumeric characters.
12. When first initialization succeeds, the service shall write the initial credentials to `/data/initial-credentials.txt` and print them once to the container log; when either credential is changed, it shall delete that file.
13. When an existing database has no corresponding persistent master key and no explicitly supplied legacy key, the service shall refuse to start rather than generate a replacement key.
14. When the account owner changes credentials or enables or disables TOTP, the system shall retain the current web session and immediately revoke every other web and Windows session.
15. When TOTP setup is requested, the system shall issue a time-limited pending secret and a standard SHA-1, six-digit, 30-second `otpauth://` URI compatible with common authenticator applications; it shall enable TOTP only after a valid confirmation code.
16. When a browser request supplies an Origin, the service shall require it to match the proxy-preserved Host and, in production, use HTTPS; it shall trust forwarded client addresses only from loopback or private direct peers.
17. When the recovery command is run, it shall support random or manual credentials, a minimum eight-character manual password, and keep/disable/regenerate TOTP choices, then revoke all sessions.
18. When the Windows client is published for x64, the build shall produce a self-contained single executable with the Voice Relay application icon and no separately required .NET runtime.
19. When the user closes a Windows settings or login window, the client shall remain running in the notification area; application termination shall be available from the notification-area context menu.
20. When the user enables or disables automatic startup from the notification-area menu, the client shall update the current user's Windows logon startup entry and reflect failures without terminating the client.
21. When the PWA initializes libsodium, the server CSP shall permit WebAssembly compilation with `wasm-unsafe-eval` while continuing to prohibit general `unsafe-eval` script execution.
22. When the x64 Windows client calls `SendInput`, its managed `INPUT` structure shall match the 40-byte native Windows ABI so that submitting Ctrl+V does not fail with `ERROR_INVALID_PARAMETER`.
23. When the PWA is opened on a phone, it shall present a quiet personal-tool interface with plain Chinese labels, a light natural palette, clear device and send states, and no commercial landing-page language or industrial visual treatment.

## Constraints and non-goals

- Windows 10 Enterprise LTSC 21H2 x64 and Windows 11 x64 are supported.
- Android Chrome and iPhone Safari/PWA are supported; speech recognition comes from the system keyboard.
- Plain text includes Unicode, emoji, tabs, and line breaks but excludes rich text, images, fonts, and colors.
- Native mobile apps, multiple users, broadcast sends, offline queues, cloud message history, automatic desktop updates, and automatic Enter are out of scope.
- Locked desktops, UAC secure desktop, higher-integrity targets, and non-interactive sessions are unsupported Windows security boundaries.
- Domain names, certificates, ports 80/443, and reverse-proxy configuration remain user-managed and are not generated by this project.
