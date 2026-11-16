#!/bin/sh
# Nightly logical backup of the WarsWorld database.
#
# Custom format (-Fc) rather than plain SQL: it is compressed and restorable selectively with
# pg_restore, which matters because the event log dominates the dump size.
#
# Connection settings come from the standard PG* environment variables (see docker-compose.prod.yml).

set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP="${BACKUP_KEEP:-14}"

mkdir -p "$BACKUP_DIR"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/warsworld-$stamp.dump"

# Write to .tmp and rename only on success. A dump interrupted midway (container restart, disk full)
# would otherwise sit in the directory looking exactly like a good one — and get counted as a
# retained copy, silently rotating a real backup out.
pg_dump --format=custom --compress=9 --file="$target.tmp"
mv "$target.tmp" "$target"

echo "[backup] wrote $target ($(du -h "$target" | cut -f1))"

# Retain the newest $KEEP dumps.
# shellcheck disable=SC2012  # filenames are timestamps we control, so `ls` is safe here
ls -1t "$BACKUP_DIR"/warsworld-*.dump 2>/dev/null | tail -n "+$((KEEP + 1))" | while read -r old; do
  echo "[backup] pruning $old"
  rm -f "$old"
done

# Clean up any stale partials from a previous crash.
find "$BACKUP_DIR" -name 'warsworld-*.dump.tmp' -mmin +120 -delete 2>/dev/null || true
