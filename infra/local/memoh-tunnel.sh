#!/usr/bin/env bash
# 从本机经 SSH 隧道访问 vultr-sg 上的 Memoh dev 环境。
# 用法:
#   memoh-tunnel.sh start   # 建立 18080/18082 隧道（后台，幂等）
#   memoh-tunnel.sh stop
#   memoh-tunnel.sh status
# 隧道建立后：Web UI http://127.0.0.1:18082 ，API http://127.0.0.1:18080
set -euo pipefail

LOCAL_API=18080
LOCAL_WEB=18082
REMOTE_API=18080     # vultr 上 server 绑的本地端口
REMOTE_WEB=18082
CTL="$HOME/.memoh-ios-tunnel"
PIDFILE="$CTL/tunnel.pid"

case "${1:-status}" in
  start)
    mkdir -p "$CTL"
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "already running (pid $(cat "$PIDFILE"))"; exit 0
    fi
    ssh -f -N \
      -o ExitOnForwardFailure=yes \
      -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
      -L "127.0.0.1:${LOCAL_API}:127.0.0.1:${REMOTE_API}" \
      -L "127.0.0.1:${LOCAL_WEB}:127.0.0.1:${REMOTE_WEB}" \
      vultr-sg
    # ssh -f 不回传 pid，从进程表里取
    sleep 1
    pgrep -f "127.0.0.1:${LOCAL_API}:127.0.0.1:${REMOTE_API}" | tail -1 > "$PIDFILE"
    echo "tunnel up: api http://127.0.0.1:${LOCAL_API}  web http://127.0.0.1:${LOCAL_WEB}"
    ;;
  stop)
    if [ -f "$PIDFILE" ]; then kill "$(cat "$PIDFILE")" 2>/dev/null || true; rm -f "$PIDFILE"; fi
    pkill -f "127.0.0.1:${LOCAL_API}:127.0.0.1:${REMOTE_API}" 2>/dev/null || true
    echo "tunnel stopped"
    ;;
  status)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "running (pid $(cat "$PIDFILE"))"
      curl -s -m 5 -o /dev/null -w "api  %{http_code}\n" "http://127.0.0.1:${LOCAL_API}/health" || true
      curl -s -m 5 -o /dev/null -w "web  %{http_code}\n" "http://127.0.0.1:${LOCAL_WEB}/" || true
    else
      echo "stopped"
    fi
    ;;
  *) sed -n '2,8p' "$0" ;;
esac
