import os from "os";
import path from "path";
import fs from "fs";
import net from "net";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

let tauriDriver;
let viteDevServer;
let exit = false;

function npmBin() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function spawnNpm(args, opts) {
  if (process.platform === "win32") {
    return spawn("cmd.exe", ["/d", "/s", "/c", "npm", ...args], opts);
  }
  return spawn(npmBin(), args, opts);
}

function spawnNpmSync(args, opts) {
  if (process.platform === "win32") {
    return spawnSync("cmd.exe", ["/d", "/s", "/c", "npm", ...args], opts);
  }
  return spawnSync(npmBin(), args, opts);
}

function applicationPath() {
  const bin = process.platform === "win32" ? "tauri-app.exe" : "tauri-app";
  return path.resolve(__dirname, "..", "src-tauri", "target", "debug", bin);
}

function tauriDriverPath() {
  const envPath = (process.env.TAURI_DRIVER_PATH ?? "").trim();
  if (envPath) {
    if (fs.existsSync(envPath)) return envPath;
    return envPath;
  }

  const bin = process.platform === "win32" ? "tauri-driver.exe" : "tauri-driver";
  const fromCargoHome = path.resolve(os.homedir(), ".cargo", "bin", bin);
  if (fs.existsSync(fromCargoHome)) return fromCargoHome;

  if (process.platform === "win32") {
    const out = spawnSync("where", [bin], { encoding: "utf-8" });
    const lines = String(out.stdout ?? "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length > 0) return lines[0];
  } else {
    const out = spawnSync("which", [bin], { encoding: "utf-8" });
    const p = String(out.stdout ?? "").trim();
    if (p) return p;
  }

  return "";
}

function nativeDriverPath() {
  const envPath = (process.env.TAURI_NATIVE_DRIVER_PATH ?? process.env.MS_EDGE_DRIVER_PATH ?? "").trim();
  if (envPath) {
    if (fs.existsSync(envPath)) return envPath;
    return envPath;
  }

  if (process.platform !== "win32") return "";

  const bin = "msedgedriver.exe";
  const out = spawnSync("where", [bin], { encoding: "utf-8" });
  const lines = String(out.stdout ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length > 0) return lines[0];
  return "";
}

function isTcpPortOpen(host, port, timeoutMs = 250) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (ok) => {
      if (done) return;
      done = true;
      try {
        socket.destroy();
      } catch {}
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

async function waitForTcpPort(host, port, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await isTcpPortOpen(host, port, 250);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${host}:${port}`);
}

function closeTauriDriver() {
  exit = true;
  tauriDriver?.kill();
}

function closeViteDevServer() {
  const p = viteDevServer;
  viteDevServer = undefined;
  if (!p) return;

  if (process.platform === "win32" && typeof p.pid === "number") {
    try {
      spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" });
      return;
    } catch {}
  }

  try {
    p.kill();
  } catch {}
}

process.on("exit", () => {
  closeViteDevServer();
  closeTauriDriver();
});

process.on("SIGINT", () => {
  closeViteDevServer();
  closeTauriDriver();
  process.exit(130);
});

process.on("SIGTERM", () => {
  closeViteDevServer();
  closeTauriDriver();
  process.exit(143);
});

export const config = {
  host: "127.0.0.1",
  port: 4444,
  specs: ["./test/specs/**/*.e2e.js"],
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      "tauri:options": {
        application: applicationPath(),
      },
    },
  ],
  reporters: [
    "spec",
    [
      "junit",
      {
        outputDir: "./reports/junit",
        addFileAttribute: true,
        outputFileFormat: (opts) => `results-${opts.cid}.xml`,
      },
    ],
  ],
  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 120000,
  },
  onPrepare: async () => {
    try {
      const out = spawnNpmSync(["run", "tauri", "build", "--", "--debug", "--no-bundle"], {
        cwd: path.resolve(__dirname, ".."),
        stdio: "inherit",
      });

      if (typeof out.status === "number" && out.status !== 0) {
        throw new Error(`tauri build failed with exit code: ${out.status}`);
      }

      const devHost = "127.0.0.1";
      const devPort = 1420;

      if (!(await isTcpPortOpen(devHost, devPort, 250))) {
        viteDevServer = spawnNpm(["run", "dev"], {
          cwd: path.resolve(__dirname, ".."),
          stdio: "inherit",
        });
        await waitForTcpPort(devHost, devPort, 60000);
      }

      const driverPath = tauriDriverPath();
      if (!driverPath) {
        throw new Error(
          "tauri-driver was not found. Install it with: cargo install tauri-driver (and ensure %USERPROFILE%\\.cargo\\bin is on PATH), or set TAURI_DRIVER_PATH to the full path."
        );
      }

      const args = [];
      const native = nativeDriverPath();
      if (process.platform === "win32") {
        if (!native) {
          throw new Error(
            "msedgedriver.exe was not found (required on Windows). Put msedgedriver.exe on PATH or set TAURI_NATIVE_DRIVER_PATH (or MS_EDGE_DRIVER_PATH). You can download it from https://developer.microsoft.com/en-us/microsoft-edge/tools/webdriver/ or via msedgedriver-tool (see https://v2.tauri.app/develop/tests/webdriver/)."
          );
        }
        args.push("--native-driver", native);
      }

      tauriDriver = spawn(driverPath, args, {
        stdio: [null, process.stdout, process.stderr],
      });

      tauriDriver.on("error", (error) => {
        console.error("tauri-driver error:", error);
        process.exitCode = 1;
      });

      tauriDriver.on("exit", (code) => {
        if (!exit) {
          console.error("tauri-driver exited with code:", code);
          process.exitCode = 1;
        }
      });
    } catch (e) {
      console.error("Error in onPrepare:", e);
      process.exitCode = 1;
      closeViteDevServer();
      closeTauriDriver();
      process.exit(1);
    }
  },
  onComplete: () => {
    closeViteDevServer();
    closeTauriDriver();
  },
};
