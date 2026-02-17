#!/bin/sh
# entrypoint.sh — starts opencode serve with background log housekeeping.
#
# Two log sources are managed here:
#
#   1. /root/.local/share/opencode/log/  — opencode's own internal log files,
#      written into the persistent 'opencode-share' volume. Without cleanup
#      these grow forever. We purge files older than LOG_RETENTION_DAYS.
#
#   2. stdout/stderr (this process) — captured by Docker's json-file driver,
#      already size-capped via max-size/max-file in docker-compose.yml.
#      No extra action needed here.
#
# Environment variables (all optional, defaults shown):
#   OPENCODE_LOG_LEVEL    DEBUG|INFO|WARN|ERROR  (default: INFO)
#   LOG_RETENTION_DAYS    integer days to keep log files  (default: 7)
#   LOG_CLEANUP_INTERVAL  seconds between cleanup runs    (default: 86400 = 24h)

set -e

LOG_DIR="/root/.local/share/opencode/log"
RETENTION="${LOG_RETENTION_DAYS:-7}"
INTERVAL="${LOG_CLEANUP_INTERVAL:-86400}"

# ── Log cleanup function ───────────────────────────────────────────────────────
cleanup_logs() {
  if [ ! -d "$LOG_DIR" ]; then
    return
  fi

  before=$(find "$LOG_DIR" -type f | wc -l)

  # Delete log files (and common compressed variants) older than RETENTION days
  find "$LOG_DIR" -type f \( -name "*.log" -o -name "*.log.gz" -o -name "*.log.bz2" \) \
    -mtime +"$RETENTION" -delete 2>/dev/null || true

  # Remove any now-empty subdirectories
  find "$LOG_DIR" -mindepth 1 -type d -empty -delete 2>/dev/null || true

  after=$(find "$LOG_DIR" -type f | wc -l)
  removed=$(( before - after ))

  if [ "$removed" -gt 0 ]; then
    echo "[entrypoint] log cleanup: removed $removed file(s) older than ${RETENTION} days from $LOG_DIR"
  fi
}

# ── Background cleanup loop ───────────────────────────────────────────────────
run_cleanup_loop() {
  # Initial cleanup on startup
  cleanup_logs

  # Then repeat every INTERVAL seconds
  while true; do
    sleep "$INTERVAL"
    cleanup_logs
  done
}

echo "[entrypoint] starting log cleanup loop (retention=${RETENTION}d, interval=${INTERVAL}s)"
run_cleanup_loop &
CLEANUP_PID=$!

# Propagate SIGTERM/SIGINT to both the cleanup loop and opencode
trap 'kill "$CLEANUP_PID" 2>/dev/null; exit 0' TERM INT

# ── Start opencode serve ──────────────────────────────────────────────────────
# Global flags (--print-logs, --log-level) MUST come before the subcommand.
echo "[entrypoint] starting opencode serve (log-level=${OPENCODE_LOG_LEVEL:-INFO})"
exec opencode \
  --print-logs \
  --log-level "${OPENCODE_LOG_LEVEL:-INFO}" \
  serve \
  --port 4096 \
  --hostname 0.0.0.0
