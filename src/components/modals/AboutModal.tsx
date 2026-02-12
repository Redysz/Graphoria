import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type SystemInfo = {
  os_name: string;
  os_version: string;
  arch: string;
  tauri_version: string;
};

const APP_VERSION = "1.0.0";

function GraphBackground() {
  return (
    <svg
      className="aboutGraphBg"
      viewBox="0 0 600 400"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid slice"
    >
      {/* Edges */}
      <line x1="80" y1="60" x2="180" y2="60" stroke="currentColor" strokeWidth="2" />
      <line x1="180" y1="60" x2="300" y2="60" stroke="currentColor" strokeWidth="2" />
      <line x1="300" y1="60" x2="420" y2="60" stroke="currentColor" strokeWidth="2" />
      <line x1="420" y1="60" x2="540" y2="60" stroke="currentColor" strokeWidth="2" />

      <line x1="180" y1="60" x2="240" y2="140" stroke="currentColor" strokeWidth="2" />
      <line x1="240" y1="140" x2="360" y2="140" stroke="currentColor" strokeWidth="2" />
      <line x1="360" y1="140" x2="420" y2="60" stroke="currentColor" strokeWidth="2" />

      <line x1="240" y1="140" x2="300" y2="220" stroke="currentColor" strokeWidth="2" />
      <line x1="300" y1="220" x2="420" y2="220" stroke="currentColor" strokeWidth="2" />

      <line x1="80" y1="300" x2="180" y2="300" stroke="currentColor" strokeWidth="2" />
      <line x1="180" y1="300" x2="300" y2="300" stroke="currentColor" strokeWidth="2" />
      <line x1="300" y1="300" x2="420" y2="300" stroke="currentColor" strokeWidth="2" />
      <line x1="180" y1="300" x2="240" y2="360" stroke="currentColor" strokeWidth="2" />
      <line x1="240" y1="360" x2="360" y2="360" stroke="currentColor" strokeWidth="2" />
      <line x1="360" y1="360" x2="420" y2="300" stroke="currentColor" strokeWidth="2" />

      <line x1="420" y1="220" x2="520" y2="300" stroke="currentColor" strokeWidth="2" strokeDasharray="6,4" />

      {/* Nodes — main line */}
      <circle cx="80" cy="60" r="10" fill="currentColor" opacity="0.35" />
      <circle cx="180" cy="60" r="10" fill="currentColor" opacity="0.35" />
      <circle cx="300" cy="60" r="10" fill="currentColor" opacity="0.35" />
      <circle cx="420" cy="60" r="10" fill="currentColor" opacity="0.35" />
      <circle cx="540" cy="60" r="10" fill="currentColor" opacity="0.35" />

      {/* Nodes — branch 1 */}
      <circle cx="240" cy="140" r="8" fill="currentColor" opacity="0.25" />
      <circle cx="360" cy="140" r="8" fill="currentColor" opacity="0.25" />

      {/* Nodes — branch 2 */}
      <circle cx="300" cy="220" r="8" fill="currentColor" opacity="0.20" />
      <circle cx="420" cy="220" r="8" fill="currentColor" opacity="0.20" />

      {/* Nodes — bottom line */}
      <circle cx="80" cy="300" r="10" fill="currentColor" opacity="0.18" />
      <circle cx="180" cy="300" r="10" fill="currentColor" opacity="0.18" />
      <circle cx="300" cy="300" r="10" fill="currentColor" opacity="0.18" />
      <circle cx="420" cy="300" r="10" fill="currentColor" opacity="0.18" />
      <circle cx="520" cy="300" r="10" fill="currentColor" opacity="0.18" />

      <circle cx="240" cy="360" r="7" fill="currentColor" opacity="0.14" />
      <circle cx="360" cy="360" r="7" fill="currentColor" opacity="0.14" />

      {/* Decorative ref labels */}
      <rect x="50" y="36" rx="4" ry="4" width="60" height="16" fill="currentColor" opacity="0.08" />
      <rect x="510" y="36" rx="4" ry="4" width="60" height="16" fill="currentColor" opacity="0.08" />
      <rect x="270" y="242" rx="4" ry="4" width="60" height="14" fill="currentColor" opacity="0.06" />
      <rect x="390" y="242" rx="4" ry="4" width="60" height="14" fill="currentColor" opacity="0.06" />
    </svg>
  );
}

export function AboutModal(props: { onClose: () => void }) {
  const { onClose } = props;
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);

  useEffect(() => {
    invoke<SystemInfo>("get_system_info").then(setSysInfo).catch(() => {});
  }, []);

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal aboutModal">
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>About Graphoria</div>
          <button type="button" onClick={onClose} title="Close" style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", padding: "2px 6px", lineHeight: 1 }}>✕</button>
        </div>

        <div className="modalBody aboutBody">
          <GraphBackground />

          <div className="aboutContent">
            <div className="aboutLogoRow">
              <img src="/graphoria-logo.svg" alt="Graphoria" className="aboutLogo" />
            </div>

            <div className="aboutVersion">Version {APP_VERSION}</div>

            <p className="aboutTagline">
              A modern, visual Git client for developers who love graphs.
            </p>

            <div className="aboutLinks">
              <a
                href="https://graphoria.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="aboutLink"
                onClick={(e) => { e.preventDefault(); /* TODO: open URL via Tauri */ }}
              >
                graphoria.dev
              </a>

              <button
                type="button"
                className="aboutDonateBtn"
                title="Support the project"
                onClick={() => { /* TODO: open buymeacoffee link */ }}
              >
                ☕ Buy me a coffee
              </button>
            </div>

            <div className="aboutSection">
              <div className="aboutSectionTitle">Contributors</div>
              <div className="aboutContributorsEmpty">
                Be the first contributor! Check out our GitHub to get started.
              </div>
            </div>

            <div className="aboutSection">
              <div className="aboutSectionTitle">System Information</div>
              <div className="aboutSysInfo">
                {sysInfo ? (
                  <table>
                    <tbody>
                      <tr><td>App version</td><td>{APP_VERSION}</td></tr>
                      <tr><td>OS</td><td>{sysInfo.os_name} ({sysInfo.arch})</td></tr>
                      <tr><td>OS version</td><td>{sysInfo.os_version}</td></tr>
                      <tr><td>Tauri</td><td>{sysInfo.tauri_version}</td></tr>
                    </tbody>
                  </table>
                ) : (
                  <span style={{ opacity: 0.6 }}>Loading…</span>
                )}
              </div>
            </div>

            <div className="aboutCopyright">
              © {new Date().getFullYear()} Graphoria. All rights reserved.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
