#!/usr/bin/env bash
set -eu

VEYRA_PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
VEYRA_PG_ROOT="$VEYRA_PROJECT_DIR/.veyra-postgres"
VEYRA_PG_DATA="$VEYRA_PG_ROOT/data"
VEYRA_PG_LOG="$VEYRA_PG_ROOT/postgres.log"
VEYRA_PG_PORT="${VEYRA_POSTGRES_PORT:-5433}"
VEYRA_PG_DATABASE="${VEYRA_POSTGRES_DATABASE:-veyra}"

find_postgres_bin() {
  if command -v pg_ctl >/dev/null 2>&1; then
    dirname "$(command -v pg_ctl)"
    return
  fi

  for candidate in /usr/lib/postgresql/*/bin; do
    if [ -x "$candidate/pg_ctl" ]; then
      echo "$candidate"
      return
    fi
  done

  echo "PostgreSQL server tools were not found. Install PostgreSQL 15 or newer." >&2
  exit 1
}

VEYRA_PG_BIN=$(find_postgres_bin)

initialize_database() {
  if [ -f "$VEYRA_PG_DATA/PG_VERSION" ]; then
    return
  fi

  mkdir -p "$VEYRA_PG_ROOT"
  "$VEYRA_PG_BIN/initdb" \
    --pgdata="$VEYRA_PG_DATA" \
    --username=postgres \
    --auth=trust \
    --encoding=UTF8 \
    --no-locale
}

database_is_ready() {
  "$VEYRA_PG_BIN/pg_isready" \
    --host=127.0.0.1 \
    --port="$VEYRA_PG_PORT" \
    --dbname=postgres >/dev/null 2>&1
}

start_database() {
  initialize_database
  if ! database_is_ready; then
    "$VEYRA_PG_BIN/pg_ctl" \
      --pgdata="$VEYRA_PG_DATA" \
      --log="$VEYRA_PG_LOG" \
      --options="-h 127.0.0.1 -p $VEYRA_PG_PORT -k $VEYRA_PG_ROOT" \
      --wait start
  fi
}

create_schema() {
  if ! "$VEYRA_PG_BIN/psql" \
    --host=127.0.0.1 \
    --port="$VEYRA_PG_PORT" \
    --username=postgres \
    --dbname=postgres \
    --no-password \
    --tuples-only \
    --no-align \
    --command="SELECT 1 FROM pg_database WHERE datname = '$VEYRA_PG_DATABASE'" | grep -qx 1; then
    "$VEYRA_PG_BIN/createdb" \
      --host=127.0.0.1 \
      --port="$VEYRA_PG_PORT" \
      --username=postgres \
      --no-password \
      "$VEYRA_PG_DATABASE"
  fi

  "$VEYRA_PG_BIN/psql" \
    --host=127.0.0.1 \
    --port="$VEYRA_PG_PORT" \
    --username=postgres \
    --dbname="$VEYRA_PG_DATABASE" \
    --no-password \
    --file="$VEYRA_PROJECT_DIR/db/schema.sql"
}

case "${1:-setup}" in
  setup)
    start_database
    create_schema
    echo "Veyra PostgreSQL is ready on 127.0.0.1:$VEYRA_PG_PORT/$VEYRA_PG_DATABASE"
    ;;
  start)
    start_database
    echo "Veyra PostgreSQL is running on port $VEYRA_PG_PORT"
    ;;
  stop)
    if [ -f "$VEYRA_PG_DATA/PG_VERSION" ]; then
      "$VEYRA_PG_BIN/pg_ctl" --pgdata="$VEYRA_PG_DATA" --wait stop
    else
      echo "Veyra PostgreSQL has not been initialized"
    fi
    ;;
  status)
    if database_is_ready; then
      echo "Veyra PostgreSQL is ready on port $VEYRA_PG_PORT"
    else
      echo "Veyra PostgreSQL is not running" >&2
      exit 1
    fi
    ;;
  *)
    echo "Usage: $0 {setup|start|stop|status}" >&2
    exit 2
    ;;
esac
