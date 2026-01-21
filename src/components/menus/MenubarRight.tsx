import type { ThemeName } from "../../appSettingsStore";

export function MenubarRight(props: {
  theme: ThemeName;
  setTheme: (next: ThemeName) => void;
  openSettings: () => void;
}) {
  const { theme, setTheme, openSettings } = props;

  return (
    <div className="menubarRight">
      <select value={theme} onChange={(e) => setTheme(e.target.value as ThemeName)} title="Theme">
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="blue">Blue</option>
        <option value="sepia">Sepia</option>
      </select>

      <button type="button" onClick={() => openSettings()} title="Settings">
        ⚙️Settings
      </button>
    </div>
  );
}
