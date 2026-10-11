#!/bin/sh
# dsh-pv-home -- live (no-restart) wiring for a DSH profile. macOS / Linux twin
# of tools/install-live.ps1; see that file for what each step is for.
#
#   sh tools/install-live.sh [profile]
set -eu

PROFILE="${1:-desktop}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PACKAGE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
PATCH_FILE="$PROFILE_DIR/cordis.patch.yml"
MODULES_DIR="$PROFILE_DIR/node_modules"
LINK_PATH="$MODULES_DIR/dsh-pv-home"

[ -d "$PROFILE_DIR" ] || { echo "no such profile directory: $PROFILE_DIR" >&2; exit 1; }
[ -f "$PATCH_FILE" ] || { echo "no cordis.patch.yml in $PROFILE_DIR" >&2; exit 1; }
mkdir -p "$MODULES_DIR"

BACKUP="$PATCH_FILE.bak-pvhome-$(date +%Y%m%d-%H%M%S)"
cp "$PATCH_FILE" "$BACKUP"
echo "backup     : $BACKUP"

if [ -L "$LINK_PATH" ]; then
  echo "link       : already present -> $(readlink "$LINK_PATH")"
else
  ln -s "$PACKAGE_DIR" "$LINK_PATH"
  echo "link       : created -> $PACKAGE_DIR"
fi

if grep -q 'id:[[:space:]]*pv-home' "$PATCH_FILE"; then
  echo "patch      : row already present, left untouched"
else
  # A trailing newline first, so an unterminated last line cannot swallow the row.
  [ "$(tail -c 1 "$PATCH_FILE" | wc -l)" -eq 1 ] || printf '\n' >> "$PATCH_FILE"
  {
    echo '- insert:'
    echo '    - id: pv-home'
    echo '      name: dsh-pv-home'
  } >> "$PATCH_FILE"
  echo "patch      : appended the pv-home insert row"
fi

echo ''
echo 'done. Refresh the DSH browser window; the home page should take over.'
echo 'the settings card needs a DSH restart (the client module graph is a boot-time snapshot).'
