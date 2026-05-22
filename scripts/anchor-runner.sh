#!/bin/bash

ANCHOR=$1
PROMPT=$2

LOG_DIR="$HOME/.claude-anchors/logs"
LOG_FILE="$LOG_DIR/$ANCHOR.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

mkdir -p "$LOG_DIR"

echo "=== $TIMESTAMP ===" >> "$LOG_FILE"

claude -p "$PROMPT" >> "$LOG_FILE" 2>&1
