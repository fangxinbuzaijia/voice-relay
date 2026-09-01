# Contributing

Contributions are welcome through GitHub issues and pull requests.

## Before opening a pull request

1. Keep the single-account, no-message-storage security model unless a proposal has been discussed first.
2. Never commit real credentials, databases, master keys, deployment addresses, or generated release archives.
3. Run the relevant checks:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Windows changes should also pass:

```powershell
dotnet test apps/windows/VoiceRelay.Windows.Tests/VoiceRelay.Windows.Tests.csproj -c Release
```

Describe behavior changes, security implications, and manual test coverage in the pull request. Use Conventional Commit-style subjects when practical, for example `fix(windows): preserve SendInput ABI layout`.

