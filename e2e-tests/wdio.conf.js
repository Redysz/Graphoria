import os from "os";
import path from "path";
import fs from "fs";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

let tauriDriver;
let exit = false;

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
    const out = spawnSync("where", [bin], { encoding: "utf-8", shell: true });
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

function closeTauriDriver() {
  exit = true;
  tauriDriver?.kill();
}

process.on("exit", () => {
  closeTauriDriver();
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
  reporters: ["spec"],
  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 120000,
  },
  onPrepare: () => {
    spawnSync("npm", ["run", "tauri", "build", "--", "--debug", "--no-bundle"], {
      cwd: path.resolve(__dirname, ".."),
      stdio: "inherit",
      shell: true,
    });
  },
  beforeSession: () => {
    const driverPath = tauriDriverPath();
    if (!driverPath) {
      throw new Error(
        "tauri-driver was not found. Install it with: cargo install tauri-driver (and ensure %USERPROFILE%\\.cargo\\bin is on PATH), or set TAURI_DRIVER_PATH to the full path."
      );
    }

    tauriDriver = spawn(driverPath, [], {
      stdio: [null, process.stdout, process.stderr],
    });

    tauriDriver.on("error", (error) => {
      console.error("tauri-driver error:", error);
      throw error;
    });

    tauriDriver.on("exit", (code) => {
      if (!exit) {
        console.error("tauri-driver exited with code:", code);
        throw new Error(`tauri-driver exited with code: ${code}`);
      }
    });
  },
  afterSession: () => {
    closeTauriDriver();
  },
};
