#!/bin/sh
# Apply pending DB migrations, then hand off to uvicorn (exec, so it is PID 1 and
# receives signals). Alembic is a no-op when the schema is already current.
set -e

# Started as root: pick the unprivileged user, hand it the data dir, re-exec as it.
#  - By default that is `dd` (uid 1000).
#  - When DD_CONTENT_DIR is a mounted working copy owned by another (non-root)
#    uid, the API runs as that uid instead: git refuses a repository owned by
#    someone else ("dubious ownership"), and the server writes to it (pull,
#    commits). The host's files are never chowned.
if [ "$(id -u)" = "0" ]; then
  data_dir="${DD_DATA_DIR:-/var/lib/data-dictionary}"
  run_uid="$(id -u dd)"
  run_gid="$(id -g dd)"
  run_home=/home/dd
  if [ -n "${DD_CONTENT_DIR:-}" ] && [ -d "$DD_CONTENT_DIR" ]; then
    owner_uid="$(stat -c %u "$DD_CONTENT_DIR")"
    if [ "$owner_uid" != 0 ] && [ "$owner_uid" != "$run_uid" ]; then
      run_uid="$owner_uid"
      run_gid="$(stat -c %g "$DD_CONTENT_DIR")"
      run_home="$data_dir/.home"
    elif [ "$owner_uid" = 0 ]; then
      echo "warning: $DD_CONTENT_DIR is owned by root; git may refuse it and the server cannot write to it." >&2
    fi
  fi
  mkdir -p "$data_dir"
  # Only when needed: a recursive chown of a large volume on every start is slow.
  [ "$(stat -c %u "$data_dir")" = "$run_uid" ] || chown -R "$run_uid:$run_gid" "$data_dir"
  mkdir -p "$run_home"
  [ "$(stat -c %u "$run_home")" = "$run_uid" ] || chown "$run_uid:$run_gid" "$run_home"
  exec setpriv --reuid="$run_uid" --regid="$run_gid" --clear-groups env HOME="$run_home" "$0" "$@"
fi

alembic upgrade head

exec uvicorn app.main:app --host 0.0.0.0 --port 8000
