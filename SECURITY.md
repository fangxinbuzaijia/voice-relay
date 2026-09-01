# Security Policy

## Supported versions

Security fixes are provided for the latest `1.x` release. Please update to the newest published container image and Windows client before reporting a problem.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature for this repository. Do not open a public issue containing:

- passwords, TOTP secrets, tokens, cookies, or private keys;
- public deployment hostnames or IP addresses that the owner has not already disclosed;
- message contents, database files, `master.key`, or credential files;
- a working exploit before a fix is available.

Include the affected version, platform, reproduction steps, expected impact, and any suggested mitigation. You should receive an acknowledgement within seven days.

## Deployment responsibility

Voice Relay does not provision TLS certificates, public ports, firewalls, DNS, or a reverse proxy. Operators are responsible for exposing the service only through valid HTTPS and for backing up the complete `data` directory securely.

