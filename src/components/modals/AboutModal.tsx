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
      viewBox="0 0 600 480"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <marker id="arrow" markerWidth="10" markerHeight="8" refX="8" refY="4" orient="auto">
          <path d="M0,0 L10,4 L0,8 Z" fill="currentColor" opacity="0.5" />
        </marker>
        <marker id="arrowLight" markerWidth="10" markerHeight="8" refX="8" refY="4" orient="auto">
          <path d="M0,0 L10,4 L0,8 Z" fill="currentColor" opacity="0.3" />
        </marker>
      </defs>

      {/* ===== TOP GRAPH — main branch with feature branch ===== */}
      {/* Main horizontal line */}
      <line x1="40" y1="55" x2="145" y2="55" stroke="currentColor" strokeWidth="3" markerEnd="url(#arrow)" />
      <line x1="180" y1="55" x2="275" y2="55" stroke="currentColor" strokeWidth="3" markerEnd="url(#arrow)" />
      <line x1="310" y1="55" x2="415" y2="55" stroke="currentColor" strokeWidth="3" markerEnd="url(#arrow)" />
      <line x1="445" y1="55" x2="555" y2="55" stroke="currentColor" strokeWidth="3" markerEnd="url(#arrow)" />

      {/* Feature branch splits off and merges back */}
      <line x1="180" y1="55" x2="230" y2="130" stroke="currentColor" strokeWidth="2.5" markerEnd="url(#arrow)" />
      <line x1="260" y1="130" x2="370" y2="130" stroke="currentColor" strokeWidth="2.5" markerEnd="url(#arrow)" />
      <line x1="395" y1="130" x2="435" y2="65" stroke="currentColor" strokeWidth="2.5" markerEnd="url(#arrow)" />

      {/* Sub-branch from feature */}
      <line x1="260" y1="130" x2="310" y2="200" stroke="currentColor" strokeWidth="2" strokeDasharray="7,4" markerEnd="url(#arrowLight)" />
      <line x1="340" y1="200" x2="425" y2="200" stroke="currentColor" strokeWidth="2" strokeDasharray="7,4" />

      {/* Main nodes */}
      <circle cx="40" cy="55" r="14" fill="currentColor" opacity="0.4" />
      <circle cx="180" cy="55" r="14" fill="currentColor" opacity="0.4" />
      <circle cx="310" cy="55" r="14" fill="currentColor" opacity="0.4" />
      <circle cx="445" cy="55" r="14" fill="currentColor" opacity="0.4" />
      <circle cx="575" cy="55" r="12" fill="currentColor" opacity="0.3" />
      {/* Inner dots to look like Graphoria commit nodes */}
      <circle cx="40" cy="55" r="6" fill="currentColor" opacity="0.25" />
      <circle cx="180" cy="55" r="6" fill="currentColor" opacity="0.25" />
      <circle cx="310" cy="55" r="6" fill="currentColor" opacity="0.25" />
      <circle cx="445" cy="55" r="6" fill="currentColor" opacity="0.25" />

      {/* Feature branch nodes */}
      <circle cx="260" cy="130" r="12" fill="currentColor" opacity="0.35" />
      <circle cx="400" cy="130" r="12" fill="currentColor" opacity="0.35" />
      <circle cx="260" cy="130" r="5" fill="currentColor" opacity="0.2" />
      <circle cx="400" cy="130" r="5" fill="currentColor" opacity="0.2" />

      {/* Sub-branch nodes */}
      <circle cx="340" cy="200" r="10" fill="currentColor" opacity="0.22" />
      <circle cx="440" cy="200" r="10" fill="currentColor" opacity="0.22" />

      {/* Ref labels — branch badges */}
      <rect x="10" y="28" rx="5" ry="5" width="62" height="18" fill="currentColor" opacity="0.12" />
      <rect x="548" y="28" rx="5" ry="5" width="50" height="18" fill="currentColor" opacity="0.10" />
      <rect x="230" y="104" rx="4" ry="4" width="58" height="16" fill="currentColor" opacity="0.09" />

      {/* ===== BOTTOM GRAPH — independent smaller graph ===== */}
      {/* Main line */}
      <line x1="60" y1="340" x2="165" y2="340" stroke="currentColor" strokeWidth="3" markerEnd="url(#arrowLight)" />
      <line x1="195" y1="340" x2="310" y2="340" stroke="currentColor" strokeWidth="3" markerEnd="url(#arrowLight)" />
      <line x1="340" y1="340" x2="445" y2="340" stroke="currentColor" strokeWidth="3" markerEnd="url(#arrowLight)" />
      <line x1="475" y1="340" x2="560" y2="340" stroke="currentColor" strokeWidth="2" />

      {/* Branch off */}
      <line x1="195" y1="340" x2="250" y2="410" stroke="currentColor" strokeWidth="2" markerEnd="url(#arrowLight)" />
      <line x1="280" y1="410" x2="380" y2="410" stroke="currentColor" strokeWidth="2" markerEnd="url(#arrowLight)" />
      <line x1="405" y1="410" x2="460" y2="348" stroke="currentColor" strokeWidth="2" markerEnd="url(#arrowLight)" />

      {/* Bottom nodes */}
      <circle cx="60" cy="340" r="13" fill="currentColor" opacity="0.25" />
      <circle cx="195" cy="340" r="13" fill="currentColor" opacity="0.25" />
      <circle cx="340" cy="340" r="13" fill="currentColor" opacity="0.25" />
      <circle cx="475" cy="340" r="13" fill="currentColor" opacity="0.25" />
      <circle cx="575" cy="340" r="10" fill="currentColor" opacity="0.18" />

      <circle cx="60" cy="340" r="5" fill="currentColor" opacity="0.15" />
      <circle cx="195" cy="340" r="5" fill="currentColor" opacity="0.15" />
      <circle cx="340" cy="340" r="5" fill="currentColor" opacity="0.15" />
      <circle cx="475" cy="340" r="5" fill="currentColor" opacity="0.15" />

      {/* Branch nodes */}
      <circle cx="280" cy="410" r="11" fill="currentColor" opacity="0.20" />
      <circle cx="405" cy="410" r="11" fill="currentColor" opacity="0.20" />
      <circle cx="280" cy="410" r="4" fill="currentColor" opacity="0.12" />
      <circle cx="405" cy="410" r="4" fill="currentColor" opacity="0.12" />

      {/* Bottom ref label */}
      <rect x="30" y="314" rx="5" ry="5" width="60" height="17" fill="currentColor" opacity="0.10" />
      <rect x="250" y="428" rx="4" ry="4" width="62" height="15" fill="currentColor" opacity="0.08" />

      {/* ===== Scattered decorative elements ===== */}
      {/* Loose floating node pair in middle-right */}
      <circle cx="530" cy="240" r="8" fill="currentColor" opacity="0.12" />
      <circle cx="570" cy="260" r="6" fill="currentColor" opacity="0.08" />
      <line x1="536" y1="245" x2="565" y2="256" stroke="currentColor" strokeWidth="1.5" opacity="0.12" />

      {/* Small tag icon hint top-right */}
      <rect x="500" y="150" rx="3" ry="3" width="40" height="14" fill="currentColor" opacity="0.07" />

      {/* Tiny lone node bottom-left */}
      <circle cx="30" cy="440" r="6" fill="currentColor" opacity="0.08" />
      <circle cx="80" cy="460" r="5" fill="currentColor" opacity="0.06" />
      <line x1="34" y1="444" x2="76" y2="457" stroke="currentColor" strokeWidth="1" opacity="0.08" />
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
                href="https://gitgraphoria.com"
                target="_blank"
                rel="noopener noreferrer"
                className="aboutLink"
                onClick={(e) => { e.preventDefault(); /* TODO: open URL via Tauri */ }}
              >
                gitgraphoria.com
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
              Graphoria is a completely free, open source application distributed without any warranty.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
