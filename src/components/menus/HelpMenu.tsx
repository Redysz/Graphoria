export function HelpMenu(props: {
  helpMenuOpen: boolean;
  setHelpMenuOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
  closeOtherMenus: () => void;
  openAbout: () => void;
}) {
  const { helpMenuOpen, setHelpMenuOpen, closeOtherMenus, openAbout } = props;

  return (
    <div style={{ position: "relative" }}>
      <div
        className="menuitem"
        onClick={() => {
          closeOtherMenus();
          setHelpMenuOpen((v) => !v);
        }}
        style={{ cursor: "pointer", userSelect: "none" }}
      >
        Help
      </div>
      {helpMenuOpen ? (
        <div className="menuDropdown">
          <button
            type="button"
            onClick={() => {
              setHelpMenuOpen(false);
              openAbout();
            }}
          >
            About Graphoria
          </button>
        </div>
      ) : null}
    </div>
  );
}
