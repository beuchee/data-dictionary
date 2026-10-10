#!/bin/sh
# Apply pending DB migrations, then hand off to uvicorn (exec, so it is PID 1 and
# receives signals). Alembic is a no-op when the schema is already current.
set -e

# Started as root: hand the data dir to the unprivileged user, then re-exec as it.
if [ "$(id -u)" = "0" ]; then
  data_dir="${DD_DATA_DIR:-/var/lib/data-dictionary}"
  mkdir -p "$data_dir"
  [ "$(stat -c %U "$data_dir")" = dd ] || chown -R dd:dd "$data_dir"
  exec setpriv --reuid=dd --regid=dd --init-groups env HOME=/home/dd "$0" "$@"
fi

alembic upgrade head

exec uvicorn app.main:app --host 0.0.0.0 --port 8000
