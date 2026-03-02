#!/bin/bash
cd "$(dirname "$0")"
echo "タスク管理アプリを起動します..."
echo "http://localhost:8080 でアクセスしてください"
echo "終了: Ctrl+C"
python3 server.py
