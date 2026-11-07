#!/usr/bin/env bash
# Regenerate the profile cards from live GitHub data and push if anything moved.
#
# Run by hand:      ./scripts/daily-refresh.sh
# Schedule it:      copy the plist below to ~/Library/LaunchAgents/com.niilante.profile-refresh.plist
#                   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.niilante.profile-refresh.plist
#
#   <?xml version="1.0" encoding="UTF-8"?>
#   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
#   <plist version="1.0"><dict>
#     <key>Label</key><string>com.niilante.profile-refresh</string>
#     <key>ProgramArguments</key><array>
#       <string>/bin/bash</string>
#       <string>REPO_PATH/scripts/daily-refresh.sh</string></array>
#     <key>StartCalendarInterval</key><dict>
#       <key>Hour</key><integer>7</integer><key>Minute</key><integer>15</integer></dict>
#     <key>StandardOutPath</key><string>/tmp/niilante-profile.log</string>
#     <key>StandardErrorPath</key><string>/tmp/niilante-profile.err</string>
#   </dict></plist>
#
# The numbers include private contributions, which only the `gh` CLI logged in as
# you can read, so this runs from your machine rather than from a GitHub Action
# (a workflow's GITHUB_TOKEN is not you, and would silently publish public-only counts).

set -euo pipefail
cd "$(dirname "$0")/.."

# launchd starts with a bare PATH; gh lives in ~/.local/bin here
export PATH="${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"

node scripts/generate.mjs

if [[ -n "$(git status --porcelain assets)" ]]; then
  git add assets
  git commit -q -m "Refresh profile numbers ($(date -u +%Y-%m-%d))"
  git push -q origin master
  echo "pushed $(date -u +%Y-%m-%dT%H:%M:%SZ)"
else
  echo "nothing changed"
fi
