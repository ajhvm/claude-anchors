#!/bin/bash

ANCHOR=$1
SCHEDULED_TIME=$2

CONFIG_FILE="$HOME/.claude-anchors/config.json"
LOG_DIR="$HOME/.claude-anchors/logs"
LOG_FILE="$LOG_DIR/$ANCHOR.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

mkdir -p "$LOG_DIR"

WINDOW_DURATION=5
PROMPT="New context window open. Reply OK only."
if [ -f "$CONFIG_FILE" ]; then
  WINDOW_DURATION=$(python3 -c "import json,sys; c=json.load(open('$CONFIG_FILE')); sys.stdout.write(str(c.get('windowDuration',5)))" 2>/dev/null || echo 5)
  PROMPT=$(python3 -c "import json,sys; c=json.load(open('$CONFIG_FILE')); sys.stdout.write(c.get('prompt','New context window open. Reply OK only.'))" 2>/dev/null || echo "New context window open. Reply OK only.")
fi

TODAY=$(date '+%Y-%m-%d')
if date --version 2>/dev/null | grep -q GNU; then
  WINDOW_END=$(date -d "$TODAY $SCHEDULED_TIME + $WINDOW_DURATION hours" '+%s')
else
  WINDOW_END=$(date -v+${WINDOW_DURATION}H -j -f "%Y-%m-%d %H:%M" "$TODAY $SCHEDULED_TIME" '+%s')
fi
NOW=$(date '+%s')

if [ "$NOW" -gt "$WINDOW_END" ]; then
  printf "=== %s ===\n" "$TIMESTAMP" >> "$LOG_FILE"
  printf "SKIPPED: Window expired\n\n" >> "$LOG_FILE"
  exit 0
fi

printf "=== %s ===\n" "$TIMESTAMP" >> "$LOG_FILE"
claude -p "$PROMPT" >> "$LOG_FILE" 2>&1
printf "\n" >> "$LOG_FILE"
