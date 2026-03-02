(function () {
  const termContainer = document.getElementById("term-container");
  const btnNew = document.getElementById("btn-new-terminal");

  let term, fitAddon, ws, resizeObserver;

  function initTerminal() {
    // 既存のリソースをクリーンアップ
    if (ws) {
      ws.onclose = null;
      ws.close();
      ws = null;
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (term) {
      term.dispose();
      term = null;
    }

    // xterm.js 初期化
    term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"Cascadia Code", "Fira Code", "Consolas", monospace',
      theme: {
        background: "#1a1a2e",
        foreground: "#d4d4d4",
        cursor: "#d4d4d4",
        cursorAccent: "#1a1a2e",
        selectionBackground: "rgba(255,255,255,0.2)",
      },
    });

    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);

    term.open(termContainer);
    fitAddon.fit();

    // WebSocket接続
    var protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(protocol + "//" + location.host + "/ws/terminal");
    ws.binaryType = "arraybuffer";

    ws.onopen = function () {
      // 初期サイズ送信
      ws.send("\x01" + term.cols + "," + term.rows);
      term.focus();
    };

    ws.onmessage = function (e) {
      if (e.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(e.data));
      } else {
        term.write(e.data);
      }
    };

    ws.onclose = function () {
      term.write("\r\n\x1b[90m[disconnected]\x1b[0m\r\n");
    };

    ws.onerror = function () {
      term.write("\r\n\x1b[31m[connection error]\x1b[0m\r\n");
    };

    // キー入力 → WebSocket
    term.onData(function (data) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // リサイズ → WebSocket
    term.onResize(function (size) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send("\x01" + size.cols + "," + size.rows);
      }
    });

    // コンテナサイズ変更を監視してフィット
    resizeObserver = new ResizeObserver(function () {
      fitAddon.fit();
    });
    resizeObserver.observe(termContainer);
  }

  // New ボタン
  btnNew.addEventListener("click", function () {
    initTerminal();
  });

  // 初期化
  initTerminal();

  // タスクリスト定期更新 (10秒ごと)
  setInterval(function () {
    if (window.loadTasks) {
      window.loadTasks();
    }
  }, 10000);
})();
