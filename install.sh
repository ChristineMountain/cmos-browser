#!/usr/bin/env bash
# Install CMOS Browser in your own session on the server (one time).
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/ChristineMountain/cmos-browser/main/install.sh)
#
# Safe to run again: it repairs or finishes an earlier install and keeps your
# ratings and notes. Installs into ~/cmos-browser (or $CMOS_BROWSER_DIR).
set -euo pipefail

APP_REPO=https://github.com/ChristineMountain/cmos-browser.git
RATINGS_REPO=ChristineMountain/cmos-ratings   # private: ask the owner for an invite
DIR=${CMOS_BROWSER_DIR:-$HOME/cmos-browser}
MAMBA="$HOME/.local/bin/micromamba"
RAW=https://raw.githubusercontent.com/ChristineMountain/cmos-browser/main

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }

if [[ ! -d /data ]]; then
  warn "/data isn't here. Run this in your remote desktop on the server, where the CMOS data is."
  exit 1
fi

say "1/6  Python tools (micromamba)"
if [[ ! -x $MAMBA ]]; then
  mkdir -p "$(dirname "$MAMBA")"
  curl -fsSL https://github.com/mamba-org/micromamba-releases/releases/latest/download/micromamba-linux-64 -o "$MAMBA"
  chmod +x "$MAMBA"
fi
echo "ok"

say "2/6  The app's own Python environment (a few minutes the first time)"
mkdir -p "$DIR"
cd "$DIR"
DIR=$PWD   # absolute (micromamba needs that)
[[ -f environment.yml ]] || curl -fsSL "$RAW/environment.yml" -o environment.yml
if [[ ! -x .env/bin/python ]]; then
  "$MAMBA" create -y -q -p "$DIR/.env" -f environment.yml
else
  "$MAMBA" install -y -q -p "$DIR/.env" -f environment.yml
fi
export PATH="$DIR/.env/bin:$PATH"
echo "ok"

say "3/6  The app (from GitHub)"
if [[ ! -d .git ]]; then
  git init -q -b main
  git remote add origin "$APP_REPO"
fi
git fetch -q origin main
git checkout -q -f -B main origin/main   # files you haven't changed are updated; personal files are untouched
git branch -q --set-upstream-to=origin/main main
sha1sum environment.yml | cut -c1-40 > .env/.envhash
echo "ok: $(git log -1 --format='%h %s')"

say "4/6  Sharing ratings and notes (GitHub sign-in)"
ME=""
# Required: everyone's verdicts, ratings and notes are recorded under their GitHub name.
until gh auth status --hostname github.com > /dev/null 2>&1; do
  echo "Sign in to GitHub (required): it shows a code, opens a page, you paste the code and approve."
  echo "No GitHub account? Make one first at https://github.com/signup (free), then come back here."
  BROWSER=firefox gh auth login --hostname github.com --git-protocol https --web || true
  if ! gh auth status --hostname github.com > /dev/null 2>&1; then
    read -r -p "Not signed in. Press Enter to try again, or type q to quit: " answer < /dev/tty || answer=q
    [[ $answer == [qQ]* ]] && { warn "Not installed: a GitHub sign-in is required. Run the installer again when ready."; exit 1; }
  fi
done
if gh auth status --hostname github.com > /dev/null 2>&1; then
  gh auth setup-git --hostname github.com
  ME=$(gh api user --jq .login)
  # accept the owner's invitation to the ratings repo, if there is one
  for id in $(gh api user/repository_invitations --jq ".[] | select(.repository.full_name==\"$RATINGS_REPO\") | .id"); do
    gh api -X PATCH "user/repository_invitations/$id" > /dev/null && echo "Accepted the invitation to $RATINGS_REPO"
  done
  if [[ -d ratings-data/.git ]]; then
    git -C ratings-data pull -q --rebase || true
    echo "ok: signed in as $ME"
  elif gh repo clone "$RATINGS_REPO" ratings-data -- -q 2>/dev/null; then
    echo "ok: signed in as $ME"
  else
    warn "Signed in as $ME, but you don't have access to $RATINGS_REPO yet."
    warn "Ask the owner to invite '$ME', then run this installer again."
    warn "Until then the app works, and your ratings and notes stay on your copy."
  fi
  if [[ -d ratings-data/.git ]]; then
    git -C ratings-data config user.name "$ME"
    git -C ratings-data config user.email "$ME@users.noreply.github.com"
  fi
fi
[[ -n $ME ]] && printf '# Personal settings for this copy (not shared, not in git).\nme = "%s"\n' "$ME" > config.local.toml

say "5/6  Indexing the data (about a minute)"
./run.sh index

say "6/6  Desktop icon, and start at login"
launcher="[Desktop Entry]
Type=Application
Name=CMOS Browser
Comment=Browse the CMOS camera data
Exec=$DIR/run.sh open
Icon=applications-science
Terminal=false
Categories=Science;"
mkdir -p "$HOME/Desktop" "$HOME/.local/share/applications" "$HOME/.config/autostart"
for f in "$HOME/Desktop/cmos-browser.desktop" "$HOME/.local/share/applications/cmos-browser.desktop"; do
  printf '%s\n' "$launcher" > "$f"
  chmod +x "$f"
  gio set "$f" metadata::trusted true 2> /dev/null || true
done
cat > "$HOME/.config/autostart/cmos-browser.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=CMOS Browser watchdog
Comment=Starts CMOS Browser at login (updating it first) and restarts it if it stops
Exec=sh -c 'setsid "$DIR/run.sh" watchdog < /dev/null > /dev/null 2>&1 &'
Terminal=false
X-GNOME-Autostart-enabled=true
EOF
./run.sh restart > /dev/null
setsid ./run.sh watchdog < /dev/null > /dev/null 2>&1 &

say "Done."
echo "Double-click 'CMOS Browser' on your desktop, or open http://localhost:8010/ in Firefox here."
[[ -n $ME && ! -d ratings-data/.git ]] && warn "Remember: ask the owner to invite '$ME' to share ratings."
exit 0
