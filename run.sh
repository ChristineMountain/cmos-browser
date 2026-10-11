#!/usr/bin/env bash
# CMOS Browser control script.
#   ./run.sh start     start the web server in the background
#   ./run.sh stop      stop it
#   ./run.sh restart   stop + start
#   ./run.sh status    is it running? which port?
#   ./run.sh index [args]   update the index (e.g. ./run.sh index --only 20260915)
#   ./run.sh editlink  print your private link that unlocks editing in a browser
#   ./run.sh watchdog  keep the server up (restarts it if down); started automatically at desktop login
#   ./run.sh update    get the latest version from GitHub (also done by 'open' and at login)
#   ./run.sh open      update, start, and open the app in Firefox (the desktop icon runs this)
set -euo pipefail
cd "$(dirname "$0")"
# The app's own Python, git and gh (made by install.sh); older copies used .venv.
if [[ -x .env/bin/python ]]; then PY=.env/bin/python; export PATH="$PWD/.env/bin:$PATH"; else PY=.venv/bin/python; fi
MAMBA="$HOME/.local/bin/micromamba"
PIDFILE=server.pid
PORT=$(sed -nE 's/^port *= *([0-9]+).*/\1/p' config.toml)

# Also check the pid really is our app.py: after a container restart the old pid may belong to something else.
running() { [[ -f $PIDFILE ]] && kill -0 "$(cat $PIDFILE)" 2>/dev/null && grep -qa app.py "/proc/$(cat $PIDFILE)/cmdline" 2>/dev/null; }

case "${1:-}" in
  start)
    if running; then echo "Already running (pid $(cat $PIDFILE)) on port $PORT"; exit 0; fi
    if ss -ltn 2>/dev/null | grep -q ":$PORT "; then echo "Port $PORT is in use by another program. Change 'port' in config.toml."; exit 1; fi
    # Low CPU (nice 10) and best-effort lowest disk priority: be kind to other users.
    nohup nice -n 10 ionice -c2 -n7 $PY app.py >> server.log 2>&1 &
    echo $! > $PIDFILE
    for _ in $(seq 20); do curl -fs "http://127.0.0.1:$PORT/api/stats" >/dev/null 2>&1 && break; sleep 0.5; done
    if running; then echo "Started (pid $(cat $PIDFILE)): http://localhost:$PORT"; else echo "Failed to start; see server.log"; exit 1; fi
    ;;
  stop)
    if running; then kill "$(cat $PIDFILE)"; rm -f $PIDFILE; echo "Stopped"; else rm -f $PIDFILE; echo "Not running"; fi
    ;;
  restart) "$0" stop; sleep 1; "$0" start ;;
  status)
    if running; then echo "Running (pid $(cat $PIDFILE)) on http://localhost:$PORT"; else echo "Not running"; fi
    ;;
  index)
    shift
    nice -n 19 ionice -c2 -n7 $PY index.py "$@"
    ;;
  editlink)
    [[ -f edit_key.txt ]] || { echo "Start the server once first (./run.sh start)."; exit 1; }
    echo "Open this ONCE in a browser to allow editing collections, ratings and notes there."
    echo "Keep it private: anyone with it can edit. (Firefox in your remote desktop can always edit.)"
    echo "  http://localhost:$PORT/#/?key=$(cat edit_key.txt)"
    echo "To revoke all unlocked browsers: rm edit_key.txt && ./run.sh restart"
    ;;
  update)
    # Never fatal: without network (or with local code changes) the current version keeps running.
    [[ -d .git ]] || { echo "Not installed from GitHub; nothing to update."; exit 0; }
    before=$(git rev-parse HEAD)
    if ! timeout 30 git pull --ff-only --quiet 2>/dev/null; then echo "Couldn't update (offline, or local code changes). Using the current version."; exit 0; fi
    [[ $(git rev-parse HEAD) == "$before" ]] && { echo "Up to date."; exit 0; }
    echo "Updated to $(git log -1 --format='%h %s')"
    want=$(sha1sum environment.yml | cut -c1-40)
    if [[ -x $MAMBA && -d .env && "$(cat .env/.envhash 2>/dev/null)" != "$want" ]]; then
      echo "Updating Python packages…"
      "$MAMBA" install -y -q -p "$PWD/.env" -f environment.yml && echo "$want" > .env/.envhash
    fi
    if running; then "$0" restart; fi
    ;;
  open)
    "$0" update || true
    "$0" start
    # keep it running for the rest of the session (only one watchdog ever runs)
    setsid "$0" watchdog < /dev/null > /dev/null 2>&1 &
    (firefox "http://localhost:$PORT/" > /dev/null 2>&1 &)
    ;;
  watchdog)
    # Single instance only; checks every 60 s and restarts after 3 failed checks in a row.
    exec 9> watchdog.lock
    flock -n 9 || { echo "Watchdog already running"; exit 0; }
    "$0" update >> watchdog.log 2>&1 || true
    fails=3
    while true; do
      if curl -fs -m 10 "http://127.0.0.1:$PORT/api/stats" >/dev/null 2>&1; then fails=0
      else fails=$((fails+1)); fi
      if (( fails >= 3 )); then
        echo "$(date '+%F %T') server not responding, restarting" >> watchdog.log
        "$0" stop >> watchdog.log 2>&1 || true
        "$0" start >> watchdog.log 2>&1 || true
        fails=0
      fi
      sleep 60
    done
    ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
