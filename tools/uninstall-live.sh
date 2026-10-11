#!/bin/sh
# dsh-pv-home -- undo tools/install-live.sh. macOS / Linux twin of
# tools/uninstall-live.ps1.
#
#   sh tools/uninstall-live.sh [profile]
set -eu

PROFILE="${1:-desktop}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"

PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
PATCH_FILE="$PROFILE_DIR/cordis.patch.yml"
LINK_PATH="$PROFILE_DIR/node_modules/dsh-pv-home"

[ -f "$PATCH_FILE" ] || { echo "no cordis.patch.yml in $PROFILE_DIR" >&2; exit 1; }

if grep -q 'id:[[:space:]]*pv-home' "$PATCH_FILE"; then
  # Remove the three appended lines as one unit. Matching the sequence rather
  # than each line separately is what keeps a user's own `- insert:` block (or a
  # differently indented row) out of the blast radius.
  awk '
    { lines[NR] = $0 }
    END {
      for (i = 1; i <= NR; i++) {
        if (lines[i] == "- insert:" && lines[i+1] == "    - id: pv-home" && lines[i+2] == "      name: dsh-pv-home") { i += 2; continue }
        print lines[i]
      }
    }' "$PATCH_FILE" > "$PATCH_FILE.pvhome-tmp"
  mv "$PATCH_FILE.pvhome-tmp" "$PATCH_FILE"
  echo "patch      : pv-home insert row removed"
else
  echo "patch      : no pv-home insert row found, left untouched"
fi

if [ -L "$LINK_PATH" ]; then
  rm "$LINK_PATH"
  echo "link       : removed"
else
  echo "link       : not present"
fi

LATEST="$(ls -1t "$PATCH_FILE".bak-pvhome-* 2>/dev/null | head -n 1 || true)"
if [ -n "$LATEST" ]; then
  if cmp -s "$PATCH_FILE" "$LATEST"; then
    echo "verify     : patch file is byte-identical to $(basename "$LATEST")"
  else
    echo "verify     : FILE DIFFERS from $(basename "$LATEST") -- other edits happened after the install; nothing was reverted"
  fi
fi

echo ''
echo 'done. Refresh (or restart) DSH; the native boot page is back.'
