#!/usr/bin/env bash
# Local PostgreSQL for development and tests. Uses the system's PostgreSQL
# binaries and keeps all data inside ./.pgdata (git-ignored).
set -euo pipefail
cd "$(dirname "$0")/../.."

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PGDATA_DIR="${PGDATA_DIR:-$PWD/.pgdata}"
PGPORT="${PGPORT:-54329}"
PGUSER_LOCAL="${PGUSER_LOCAL:-sweets}"

as_pg() {
  # initdb/pg_ctl refuse to run as root; drop to the postgres user when needed.
  if [ "$(id -u)" = "0" ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi
}

case "${1:-start}" in
  start)
    if [ ! -d "$PGDATA_DIR" ]; then
      mkdir -p "$PGDATA_DIR"
      [ "$(id -u)" = "0" ] && chown postgres:postgres "$PGDATA_DIR"
      as_pg "$PGBIN/initdb -D '$PGDATA_DIR' -U $PGUSER_LOCAL --auth=trust -E UTF8 >/dev/null"
    fi
    if ! as_pg "$PGBIN/pg_ctl -D '$PGDATA_DIR' status" >/dev/null 2>&1; then
      as_pg "$PGBIN/pg_ctl -D '$PGDATA_DIR' -o '-p $PGPORT -k /tmp -c listen_addresses=127.0.0.1' -l '$PGDATA_DIR/server.log' -w start" >/dev/null
    fi
    for db in sweets sweets_test; do
      psql -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER_LOCAL" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 \
        || psql -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER_LOCAL" -d postgres -qc "CREATE DATABASE $db"
    done
    echo "PostgreSQL running on 127.0.0.1:$PGPORT (databases: sweets, sweets_test)"
    ;;
  stop)
    as_pg "$PGBIN/pg_ctl -D '$PGDATA_DIR' -m fast stop" ;;
  *)
    echo "usage: $0 [start|stop]"; exit 1 ;;
esac
