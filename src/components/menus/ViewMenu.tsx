import type { ReactNode } from "react";

export function ViewMenu(props: {
  viewMenuOpen: boolean;
  setViewMenuOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
  closeOtherMenus: () => void;

  openQuickButtonsModal: () => void;

  menuToggle: (opts: {
    label: string;
    checked: boolean;
    disabled?: boolean;
    shortcutText?: string;
    onChange: (next: boolean) => void;
  }) => ReactNode;

  showStashesOnGraph: boolean;
  showTags: boolean;
  showRemoteBranchesOnGraph: boolean;
  detailsVisible: boolean;
  sidebarVisible: boolean;
  graphButtonsVisible: boolean;
  showOnlineAvatars: boolean;
  commitsOnlyHead: boolean;
  layoutDirectionTopToBottom: boolean;
  tooltipsEnabled: boolean;

  onChangeShowStashesOnGraph: (next: boolean) => void;
  onChangeShowTags: (next: boolean) => void;
  onChangeShowRemoteBranchesOnGraph: (next: boolean) => void;
  onChangeDetailsVisible: (next: boolean) => void;
  onChangeSidebarVisible: (next: boolean) => void;
  onChangeGraphButtonsVisible: (next: boolean) => void;
  onChangeShowOnlineAvatars: (next: boolean) => void;
  onChangeCommitsOnlyHead: (next: boolean) => void;
  onChangeLayoutDirectionTopToBottom: (next: boolean) => void;
  onChangeTooltipsEnabled: (next: boolean) => void;

  shortcutShowStashesOnGraph?: string;
  shortcutShowTags?: string;
  shortcutShowRemoteBranches?: string;
  shortcutDetailsWindow?: string;
  shortcutBranchesWindow?: string;
  shortcutGraphButtons?: string;
  shortcutOnlineAvatars?: string;
  shortcutCommitsOnlyHead?: string;
  shortcutLayoutDirection?: string;
  shortcutTooltips?: string;
}) {
  const {
    viewMenuOpen,
    setViewMenuOpen,
    closeOtherMenus,
    openQuickButtonsModal,
    menuToggle,
    showStashesOnGraph,
    showTags,
    showRemoteBranchesOnGraph,
    detailsVisible,
    sidebarVisible,
    graphButtonsVisible,
    showOnlineAvatars,
    commitsOnlyHead,
    layoutDirectionTopToBottom,
    tooltipsEnabled,
    onChangeShowStashesOnGraph,
    onChangeShowTags,
    onChangeShowRemoteBranchesOnGraph,
    onChangeDetailsVisible,
    onChangeSidebarVisible,
    onChangeGraphButtonsVisible,
    onChangeShowOnlineAvatars,
    onChangeCommitsOnlyHead,
    onChangeLayoutDirectionTopToBottom,
    onChangeTooltipsEnabled,
    shortcutShowStashesOnGraph,
    shortcutShowTags,
    shortcutShowRemoteBranches,
    shortcutDetailsWindow,
    shortcutBranchesWindow,
    shortcutGraphButtons,
    shortcutOnlineAvatars,
    shortcutCommitsOnlyHead,
    shortcutLayoutDirection,
    shortcutTooltips,
  } = props;

  return (
    <div style={{ position: "relative" }}>
      <div
        className="menuitem"
        onClick={() => {
          closeOtherMenus();
          setViewMenuOpen((v) => !v);
        }}
        style={{ cursor: "pointer", userSelect: "none" }}
      >
        View
      </div>
      {viewMenuOpen ? (
        <div className="menuDropdown" style={{ minWidth: 320 }}>
          {menuToggle({
            label: "Show stashes on graph",
            shortcutText: shortcutShowStashesOnGraph,
            checked: showStashesOnGraph,
            onChange: onChangeShowStashesOnGraph,
          })}
          {menuToggle({
            label: "Show tags",
            shortcutText: shortcutShowTags,
            checked: showTags,
            onChange: onChangeShowTags,
          })}
          {menuToggle({
            label: "Show remote branches",
            shortcutText: shortcutShowRemoteBranches,
            checked: showRemoteBranchesOnGraph,
            onChange: onChangeShowRemoteBranchesOnGraph,
          })}
          <div style={{ height: 1, background: "var(--border)", margin: "2px 2px" }} />
          {menuToggle({
            label: "Show details window",
            shortcutText: shortcutDetailsWindow,
            checked: detailsVisible,
            onChange: onChangeDetailsVisible,
          })}
          {menuToggle({
            label: "Show branches window",
            shortcutText: shortcutBranchesWindow,
            checked: sidebarVisible,
            onChange: onChangeSidebarVisible,
          })}
          {menuToggle({
            label: "Show buttons on graph",
            shortcutText: shortcutGraphButtons,
            checked: graphButtonsVisible,
            onChange: onChangeGraphButtonsVisible,
          })}
          <div style={{ height: 1, background: "var(--border)", margin: "2px 2px" }} />
          {menuToggle({
            label: "Show online avatars (Gravatar)",
            shortcutText: shortcutOnlineAvatars,
            checked: showOnlineAvatars,
            onChange: onChangeShowOnlineAvatars,
          })}
          {menuToggle({
            label: "Show only commits reachable from HEAD",
            shortcutText: shortcutCommitsOnlyHead,
            checked: commitsOnlyHead,
            onChange: onChangeCommitsOnlyHead,
          })}
          {menuToggle({
            label: "Layout direction from top to bottom",
            shortcutText: shortcutLayoutDirection,
            checked: layoutDirectionTopToBottom,
            onChange: onChangeLayoutDirectionTopToBottom,
          })}
          {menuToggle({
            label: "Show tooltips",
            shortcutText: shortcutTooltips,
            checked: tooltipsEnabled,
            onChange: onChangeTooltipsEnabled,
          })}

          <div style={{ height: 1, background: "var(--border)", margin: "2px 2px" }} />
          <button
            type="button"
            onClick={() => {
              setViewMenuOpen(false);
              openQuickButtonsModal();
            }}
          >
            Rearrange quick buttons…
          </button>
        </div>
      ) : null}
    </div>
  );
}
