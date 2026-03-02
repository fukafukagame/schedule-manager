#!/usr/bin/env python3
"""タスク管理アプリ用の簡易HTTPサーバー（WebSocketターミナル付き）"""

import base64
import fcntl
import hashlib
import json
import os
import pty
import select
import signal
import socket
import struct
import termios
import threading
import uuid
from datetime import datetime
from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn
from urllib.parse import parse_qs, urlparse

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
DATA_FILE = os.path.join(DATA_DIR, "tasks.json")
PROJECTS_FILE = os.path.join(DATA_DIR, "projects.json")
PORT = 8080
WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def load_tasks():
    if not os.path.exists(DATA_FILE):
        return []
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_tasks(tasks):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(tasks, f, ensure_ascii=False, indent=2)


def load_projects():
    if not os.path.exists(PROJECTS_FILE):
        return []
    with open(PROJECTS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_projects(projects):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(PROJECTS_FILE, "w", encoding="utf-8") as f:
        json.dump(projects, f, ensure_ascii=False, indent=2)


def enrich_projects(projects, tasks):
    """プロジェクトにタスク集計情報を付加して返す"""
    enriched = []
    for p in projects:
        pid = p["id"]
        proj_tasks = [t for t in tasks if t.get("projectId") == pid]
        done = sum(1 for t in proj_tasks if t.get("status") == "完了")
        enriched.append({
            **p,
            "taskCount": len(proj_tasks),
            "doneCount": done,
            "pendingCount": len(proj_tasks) - done,
        })
    return enriched


# UIコンテキスト（インメモリ。フロントエンドが現在の表示状態を通知する）
_ui_context = {"view": "projects", "projectId": None, "projectName": None}


class TaskHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/ws/terminal" and "websocket" in self.headers.get("Upgrade", "").lower():
            self._handle_websocket_terminal()
        elif parsed.path == "/api/context":
            self._json_response(200, _ui_context)
        elif parsed.path == "/api/projects":
            projects = load_projects()
            tasks = load_tasks()
            self._json_response(200, enrich_projects(projects, tasks))
        elif parsed.path == "/api/tasks":
            tasks = load_tasks()
            qs = parse_qs(parsed.query)
            project_id = qs.get("projectId", [None])[0]
            if project_id == "none":
                tasks = [t for t in tasks if not t.get("projectId")]
            elif project_id:
                tasks = [t for t in tasks if t.get("projectId") == project_id]
            self._json_response(200, tasks)
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == "/api/projects":
            body = self._read_body()
            projects = load_projects()
            project = {
                "id": str(uuid.uuid4()),
                "name": body.get("name", ""),
                "description": body.get("description", ""),
                "color": body.get("color", "#4a6cf7"),
                "createdAt": datetime.now().isoformat(),
                "updatedAt": datetime.now().isoformat(),
            }
            projects.append(project)
            save_projects(projects)
            tasks = load_tasks()
            self._json_response(201, enrich_projects([project], tasks)[0])
        elif self.path == "/api/tasks":
            body = self._read_body()
            tasks = load_tasks()
            task = {
                "id": str(uuid.uuid4()),
                "title": body.get("title", ""),
                "description": body.get("description", ""),
                "priority": body.get("priority", "中"),
                "status": body.get("status", "未着手"),
                "deadline": body.get("deadline", ""),
                "category": body.get("category", ""),
                "timeSpent": body.get("timeSpent", 0),
                "projectId": body.get("projectId") or None,
                "createdAt": datetime.now().isoformat(),
                "updatedAt": datetime.now().isoformat(),
            }
            tasks.append(task)
            save_tasks(tasks)
            self._json_response(201, task)
        else:
            self._json_response(404, {"error": "Not found"})

    def do_PUT(self):
        if self.path == "/api/context":
            global _ui_context
            body = self._read_body()
            _ui_context = {
                "view": body.get("view", "projects"),
                "projectId": body.get("projectId"),
                "projectName": body.get("projectName"),
            }
            self._json_response(200, _ui_context)
        elif self.path.startswith("/api/projects/"):
            project_id = self.path.split("/")[-1]
            body = self._read_body()
            projects = load_projects()
            for i, p in enumerate(projects):
                if p["id"] == project_id:
                    for key in ("name", "description", "color"):
                        if key in body:
                            projects[i][key] = body[key]
                    projects[i]["updatedAt"] = datetime.now().isoformat()
                    save_projects(projects)
                    tasks = load_tasks()
                    self._json_response(200, enrich_projects([projects[i]], tasks)[0])
                    return
            self._json_response(404, {"error": "Project not found"})
        elif self.path.startswith("/api/tasks/"):
            task_id = self.path.split("/")[-1]
            body = self._read_body()
            tasks = load_tasks()
            for i, t in enumerate(tasks):
                if t["id"] == task_id:
                    for key in ("title", "description", "priority", "status", "deadline", "category", "timeSpent", "projectId"):
                        if key in body:
                            tasks[i][key] = body[key]
                    tasks[i]["updatedAt"] = datetime.now().isoformat()
                    save_tasks(tasks)
                    self._json_response(200, tasks[i])
                    return
            self._json_response(404, {"error": "Task not found"})
        else:
            self._json_response(404, {"error": "Not found"})

    def do_DELETE(self):
        if self.path.startswith("/api/projects/"):
            project_id = self.path.split("/")[-1]
            projects = load_projects()
            new_projects = [p for p in projects if p["id"] != project_id]
            if len(new_projects) == len(projects):
                self._json_response(404, {"error": "Project not found"})
            else:
                save_projects(new_projects)
                # 所属タスクを未分類に移動
                tasks = load_tasks()
                changed = False
                for t in tasks:
                    if t.get("projectId") == project_id:
                        t["projectId"] = None
                        changed = True
                if changed:
                    save_tasks(tasks)
                self._json_response(200, {"ok": True})
        elif self.path.startswith("/api/tasks/"):
            task_id = self.path.split("/")[-1]
            tasks = load_tasks()
            new_tasks = [t for t in tasks if t["id"] != task_id]
            if len(new_tasks) == len(tasks):
                self._json_response(404, {"error": "Task not found"})
            else:
                save_tasks(new_tasks)
                self._json_response(200, {"ok": True})
        else:
            self._json_response(404, {"error": "Not found"})

    # ── WebSocket Terminal ──────────────────────────────────

    def _handle_websocket_terminal(self):
        """WebSocket接続を受け入れ、PTYを起動してブリッジする"""
        key = self.headers.get("Sec-WebSocket-Key", "").strip()
        accept = base64.b64encode(
            hashlib.sha1((key + WS_MAGIC).encode()).digest()
        ).decode()

        # 生のHTTPレスポンスをソケットに直接書き込む（wfileバッファを完全回避）
        response = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept}\r\n"
            "\r\n"
        )
        self.request.sendall(response.encode("ascii"))

        # PTY起動
        pid, fd = pty.fork()
        if pid == 0:
            os.environ["TERM"] = "xterm-256color"
            os.environ.pop("CLAUDECODE", None)
            os.execvp("bash", ["bash", "--login"])

        self._pty_resize(fd, pid, 80, 24)

        stop_event = threading.Event()
        ws_lock = threading.Lock()

        def pty_reader():
            """PTY出力 → WebSocket (バイナリフレーム)"""
            while not stop_event.is_set():
                try:
                    r, _, _ = select.select([fd], [], [], 0.05)
                    if fd in r:
                        data = os.read(fd, 4096)
                        if not data:
                            stop_event.set()
                            try:
                                self.request.shutdown(socket.SHUT_RD)
                            except Exception:
                                pass
                            break
                        with ws_lock:
                            try:
                                self._ws_send_frame(2, data)
                            except (BrokenPipeError, ConnectionResetError, OSError):
                                stop_event.set()
                                break
                except OSError:
                    stop_event.set()
                    break

        reader = threading.Thread(target=pty_reader, daemon=True)
        reader.start()

        # WebSocket入力 → PTY
        try:
            while not stop_event.is_set():
                frame = self._ws_read_frame()
                if frame is None:
                    break

                opcode, data = frame
                if opcode == 8:  # close
                    break
                elif opcode == 9:  # ping
                    with ws_lock:
                        self._ws_send_frame(10, data)
                elif opcode in (1, 2):
                    if opcode == 1:
                        text = data.decode("utf-8", errors="replace")
                        if text.startswith("\x01"):
                            parts = text[1:].split(",")
                            try:
                                cols, rows = int(parts[0]), int(parts[1])
                                self._pty_resize(fd, pid, cols, rows)
                            except (ValueError, IndexError):
                                pass
                            continue
                    try:
                        os.write(fd, data)
                    except OSError:
                        break
        finally:
            stop_event.set()
            reader.join(timeout=2)
            try:
                os.close(fd)
            except OSError:
                pass
            try:
                os.kill(pid, signal.SIGTERM)
                os.waitpid(pid, 0)
            except (OSError, ChildProcessError):
                pass

        self.close_connection = True

    def _pty_resize(self, fd, pid, cols, rows):
        try:
            winsize = struct.pack("HHHH", rows, cols, 0, 0)
            fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
            os.kill(pid, signal.SIGWINCH)
        except (OSError, ProcessLookupError):
            pass

    def _ws_read_frame(self):
        """WebSocketフレームを1つ読む。(opcode, data) または None を返す。"""
        try:
            b1 = self.rfile.read(1)
            if not b1:
                return None
            b2 = self.rfile.read(1)
            if not b2:
                return None

            opcode = b1[0] & 0x0F
            masked = (b2[0] & 0x80) != 0
            length = b2[0] & 0x7F

            if length == 126:
                raw = self.rfile.read(2)
                if len(raw) < 2:
                    return None
                length = struct.unpack(">H", raw)[0]
            elif length == 127:
                raw = self.rfile.read(8)
                if len(raw) < 8:
                    return None
                length = struct.unpack(">Q", raw)[0]

            mask_key = self.rfile.read(4) if masked else b""
            payload = self.rfile.read(length) if length > 0 else b""

            if masked and mask_key:
                payload = bytearray(payload)
                for i in range(len(payload)):
                    payload[i] ^= mask_key[i % 4]
                payload = bytes(payload)

            return (opcode, payload)
        except (OSError, ConnectionResetError, TimeoutError):
            return None

    def _ws_send_frame(self, opcode, data):
        """WebSocketフレームを送信 (サーバー→クライアント、マスクなし)"""
        if isinstance(data, str):
            data = data.encode("utf-8")

        frame = bytearray()
        frame.append(0x80 | opcode)

        length = len(data)
        if length < 126:
            frame.append(length)
        elif length < 65536:
            frame.append(126)
            frame.extend(struct.pack(">H", length))
        else:
            frame.append(127)
            frame.extend(struct.pack(">Q", length))

        frame.extend(data)
        self.wfile.write(bytes(frame))
        self.wfile.flush()

    # ── HTTP helpers ────────────────────────────────────────

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)
        return json.loads(raw) if raw else {}

    def _json_response(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        first = str(args[0]) if args else ""
        if "/api/" in first:
            super().log_message(format, *args)


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    if not os.path.exists(DATA_FILE):
        save_tasks([])
    if not os.path.exists(PROJECTS_FILE):
        save_projects([])
    server = ThreadingHTTPServer(("localhost", PORT), TaskHandler)
    print(f"サーバー起動: http://localhost:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nサーバー停止")
        server.server_close()


if __name__ == "__main__":
    main()
