# Backup, upgrade, and recovery / 备份、升级与恢复

## Backup

Stop the relay before taking a consistent filesystem backup:

```bash
docker compose stop relay
tar -czf voice-relay-data-backup.tar.gz data
docker compose start relay
```

Keep the backup offline. The whole `data` directory is one recovery unit and may contain:

- `voice-relay.db`, `voice-relay.db-wal`, and `voice-relay.db-shm`;
- `master.key`;
- temporary initial or reset credential files.

Losing `master.key` makes an existing encrypted TOTP secret unreadable. Do not restore a database without its matching key.

## Upgrade

```bash
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 relay
```

The container image is replaceable; the bind-mounted `data` directory survives updates.

## Pin or roll back a version

Replace the image tag in `docker-compose.yml`, for example:

```yaml
image: ghcr.io/fangxinbuzaijia/voice-relay:1.0.0
```

Then run:

```bash
docker compose pull
docker compose up -d
```

Database migrations are forward-oriented. Restore a matching pre-upgrade `data` backup when rolling back across a migration.

## Account recovery

```bash
docker compose exec relay node apps/server/dist/cli/reset-user.js
```

The command can reset the username and password and keep, disable, or regenerate TOTP. It revokes every existing session.

