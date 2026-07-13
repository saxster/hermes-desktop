// Sidebar.tsx — workspace rail. Notion-3.1 grammar: an always-visible top icon
// row, then named/toggleable/collapsible sections (Recents/Private), the
// Obsidian Vault explorer, and the identity foot. Identity is derived from the
// active Hermes profile (demo fallback offline).
import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import type { IconName } from "../components/iconPaths";
import { useStore } from "../store";
import type { DropWhere } from "../lib/tree";
import type { TreeDnd } from "./dnd";
import { PageTree } from "./PageTree";
import { SidebarSection } from "./SidebarSection";
import { SidebarRecents } from "./SidebarRecents";
import { useVaultQuery } from "../hooks/useNoteIndex";
import { INBOX_FOLDER } from "../inbox/capture";
import { ObsidianExplorer } from "./ObsidianExplorer";
import { StatusChip } from "./StatusChip";
import { openSettings } from "../../../lib/openSettings";
import brandLogo from "../../../assets/icon.png";
import type { Surface } from "../store/storeTypes";

interface Identity {
  workspace: string;
  user: string;
  initial: string;
}

const DEMO_IDENTITY: Identity = {
  workspace: "SPS",
  user: "You",
  initial: "S",
};

type PackId =
  | "learning"
  | "research"
  | "health"
  | "equity"
  | "content"
  | "deck"
  | "obsidian"
  | "graph";

const PACKS_KEY = "sps-agent-enabled-packs-v1";
const DEFAULT_PACKS: Record<PackId, boolean> = {
  learning: false,
  research: false,
  health: false,
  equity: false,
  content: false,
  deck: false,
  obsidian: false,
  graph: false,
};

function loadPacks(): Record<PackId, boolean> {
  try {
    const raw = localStorage.getItem(PACKS_KEY);
    if (!raw) return DEFAULT_PACKS;
    return { ...DEFAULT_PACKS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PACKS;
  }
}

function savePacks(packs: Record<PackId, boolean>): void {
  try {
    localStorage.setItem(PACKS_KEY, JSON.stringify(packs));
  } catch {
    /* non-fatal UI preference */
  }
}

/** Derive the rail identity from the active Hermes profile (fallback: demo). */
function useIdentity(): Identity {
  const [identity, setIdentity] = useState<Identity>(DEMO_IDENTITY);
  useEffect(() => {
    let cancelled = false;
    const api = window.hermesAPI;
    if (!api?.listProfiles) return;
    api
      .listProfiles()
      .then((rows) => {
        const active = rows.find((r) => r.isActive) ?? rows[0];
        if (!active || cancelled) return;
        const name = active.name;
        const pretty =
          name === "default"
            ? "SPS Agent"
            : name.charAt(0).toUpperCase() + name.slice(1);
        const user = name === "default" ? "Default" : pretty;
        const initial = name === "default" ? "S" : pretty.charAt(0) || "H";
        setIdentity({
          workspace: pretty,
          user: user,
          initial: initial,
        });
      })
      .catch(() => {
        /* offline — keep demo identity */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return identity;
}

interface SidebarProps {
  displayMode?: "full" | "icons" | "hidden";
}

export function Sidebar({ displayMode }: SidebarProps = {}) {
  const tree = useStore((s) => s.tree);
  const meta = useStore((s) => s.meta);
  const activeId = useStore((s) => s.page);
  const surface = useStore((s) => s.surface);
  const setSurface = useStore((s) => s.setSurface);
  const selectPage = useStore((s) => s.selectPage);
  const libraryPages = tree.filter(
    (node) =>
      node.id !== "home" &&
      !meta[node.id]?.journal &&
      meta[node.id]?.title !== "Content Studio",
  );
  // Selecting a page always returns to the document surface.
  const selectDoc = (id: string): void => {
    selectPage(id);
    setSurface("doc");
  };
  const newSubPage = useStore((s) => s.newSubPage);
  const renamePage = useStore((s) => s.renamePage);
  const deletePage = useStore((s) => s.deletePage);
  const movePage = useStore((s) => s.movePage);
  const setPaletteOpen = useStore((s) => s.setPaletteOpen);
  const setTemplatesOpen = useStore((s) => s.setTemplatesOpen);
  const setTrashOpen = useStore((s) => s.setTrashOpen);
  const tweaksOpen = useStore((s) => s.tweaksOpen);
  const setTweaksOpen = useStore((s) => s.setTweaksOpen);
  const setTweak = useStore((s) => s.setTweak);
  const importPdf = useStore((s) => s.importPdf);
  const openJournal = useStore((s) => s.openJournal);

  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; where: DropWhere } | null>(
    null,
  );
  const dnd: TreeDnd = { drag, setDrag, over, setOver, onMove: movePage };
  const identity = useIdentity();

  const sidebar = useStore((s) => s.t.sidebar);
  const isIconsMode = (displayMode ?? sidebar) === "icons";

  const [libraryOpen, setLibraryOpen] = useState(
    () => localStorage.getItem("sps-wing-core-library") !== "false",
  );
  const [packsOpen, setPacksOpen] = useState(
    () => localStorage.getItem("sps-wing-packs") === "true",
  );
  const [packs, setPacks] = useState<Record<PackId, boolean>>(loadPacks);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const closeOnOutsidePress = (event: MouseEvent): void => {
      const target = event.target;
      if (target instanceof Node && !profileMenuRef.current?.contains(target)) {
        setProfileMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setProfileMenuOpen(false);
      profileButtonRef.current?.focus();
    };
    document.addEventListener("mousedown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileMenuOpen]);

  const toggleLibrary = (): void => {
    const next = !libraryOpen;
    setLibraryOpen(next);
    localStorage.setItem("sps-wing-core-library", String(next));
  };
  const togglePacksOpen = (): void => {
    const next = !packsOpen;
    setPacksOpen(next);
    localStorage.setItem("sps-wing-packs", String(next));
  };
  const setPackEnabled = (id: PackId, enabled: boolean): void => {
    const next = { ...packs, [id]: enabled };
    setPacks(next);
    savePacks(next);
  };

  // Live count of unprocessed captures for the Inbox badge.
  const { rows: inboxRows } = useVaultQuery(INBOX_FOLDER, [
    { prop: "status", op: "eq", value: "unprocessed" },
  ]);
  const inboxCount = inboxRows.length;

  const openPalette = (): void => setPaletteOpen(true);
  const newPage = (): void => setTemplatesOpen({ parent: null });
  const openSurface = (next: Surface): void => setSurface(next);
  const renderPackToggle = (
    id: PackId,
    label: string,
    icon: IconName,
  ): React.JSX.Element => (
    <button
      key={`${id}-enable`}
      type="button"
      className="nav-item pack-toggle-row"
      onClick={() => setPackEnabled(id, !packs[id])}
      title={label}
      aria-label={`${packs[id] ? "Disable" : "Enable"} ${label}`}
    >
      <Icon name={packs[id] ? "check" : icon} size={17} />
      <span className="nav-label">{label}</span>
      <span className="pack-state">{packs[id] ? "On" : "Enable"}</span>
    </button>
  );
  const renderPackNav = (
    id: PackId,
    label: string,
    icon: IconName,
    onClick: () => void,
    active = false,
  ): React.JSX.Element | null =>
    packs[id] ? (
      <div key={label} className={`nav-item ${active ? "active" : ""}`}>
        <button
          type="button"
          className="nav-item-main"
          onClick={onClick}
          title={label}
          aria-label={label}
        >
          <Icon name={icon} size={17} />
          <span className="nav-label">{label}</span>
        </button>
        <button
          type="button"
          className="nav-add"
          title={`Disable ${label}`}
          aria-label={`Disable ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            setPackEnabled(id, false);
          }}
        >
          <Icon name="x" size={13} />
        </button>
      </div>
    ) : null;

  return (
    <nav className="rail">
      <div className="rail-top">
        <span className="wmark">
          <img src={brandLogo} alt="SPS" className="wmark-img" />
        </span>
        <span className="wname">{identity.workspace}</span>
        <span className="rail-chev">
          <Icon name="chevD" size={15} />
        </span>
        <button
          className="rail-collapse"
          title="Hide sidebar"
          aria-label="Hide sidebar"
          onClick={(e) => {
            e.stopPropagation();
            setTweak("sidebar", "hidden");
          }}
        >
          <Icon name="panelLeft" size={16} />
        </button>
      </div>

      <div className="rail-scroll scroll">
        <div className="sec sec-static">
          <span className="sec-label">Core</span>
        </div>
        <button
          type="button"
          className="nav-item"
          onClick={openPalette}
          title="Search"
          aria-label="Search"
        >
          <Icon name="search" size={17} />
          <span className="nav-label">Search</span>
          <span className="nav-kbd">⌘K</span>
        </button>

        <button
          type="button"
          className={`nav-item ${activeId === "home" && surface === "doc" ? "active" : ""}`}
          onClick={() => selectDoc("home")}
          title="Home"
          aria-label="Home"
        >
          <Icon name="home" size={17} />
          <span className="nav-label">Home</span>
        </button>

        <div className={`nav-item ${surface === "inbox" ? "active" : ""}`}>
          <button
            type="button"
            className="nav-item-main"
            onClick={() => openSurface("inbox")}
            title="Capture"
            aria-label="Capture"
          >
            <Icon name="inbox" size={17} />
            <span className="nav-label">
              Capture {inboxCount > 0 ? `(${inboxCount})` : ""}
            </span>
          </button>
          <button
            type="button"
            className="nav-add"
            title="Import PDF"
            aria-label="Import PDF"
            onClick={(e) => {
              e.stopPropagation();
              importPdf().catch((error: unknown) => {
                console.error("[Sidebar] PDF import failed:", error);
              });
            }}
          >
            <Icon name="plus" size={14} />
          </button>
        </div>

        <button
          type="button"
          className={`nav-item ${surface === "work" ? "active" : ""}`}
          onClick={() => openSurface("work")}
          title="Work"
          aria-label="Work"
        >
          <Icon name="board" size={17} />
          <span className="nav-label">Work</span>
        </button>

        <button
          type="button"
          className={`nav-item ${surface === "chats" ? "active" : ""}`}
          onClick={() => openSurface("chats")}
          title="Assistant"
          aria-label="Assistant"
        >
          <Icon name="comment" size={17} />
          <span className="nav-label">Assistant</span>
        </button>

        <button
          type="button"
          className={`wing-header wing-header-button ${libraryOpen ? "open" : ""}`}
          onClick={toggleLibrary}
        >
          <span className={`wing-chev ${libraryOpen ? "open" : ""}`}>
            <Icon name="chevR" size={11} />
          </span>
          <span className="wing-title">Library</span>
        </button>

        {(libraryOpen || isIconsMode) && (
          <>
            <SidebarSection id="recents" label="Recents">
              <SidebarRecents />
            </SidebarSection>

            <SidebarSection
              id="private"
              label="Pages"
              onAdd={newPage}
              addTitle="New page"
            >
              <PageTree
                nodes={libraryPages}
                meta={meta}
                activeId={activeId}
                onSelect={selectDoc}
                onNewSubPage={newSubPage}
                onRename={renamePage}
                onDelete={deletePage}
                dnd={dnd}
              />
              {libraryPages.length === 0 && (
                <div className="tree-row color-tx-4-cursor-default">
                  <span className="tree-toggle leaf"></span>No pages
                </div>
              )}
              <button
                type="button"
                className="nav-item pl-12"
                onClick={newPage}
              >
                <Icon name="plus" size={14} />
                <span className="nav-label">Add page</span>
              </button>
            </SidebarSection>
          </>
        )}

        <button
          type="button"
          className={`wing-header wing-header-button ${packsOpen ? "open" : ""}`}
          onClick={togglePacksOpen}
        >
          <span className={`wing-chev ${packsOpen ? "open" : ""}`}>
            <Icon name="chevR" size={11} />
          </span>
          <span className="wing-title">Packs</span>
        </button>

        {(packsOpen || isIconsMode) && (
          <div className="pack-list">
            {renderPackNav(
              "learning",
              "Learning",
              "sparkle",
              () => openSurface("learning"),
              surface === "learning",
            ) ?? renderPackToggle("learning", "Learning", "sparkle")}
            {renderPackNav(
              "research",
              "Research",
              "search",
              () => openSurface("research"),
              surface === "research",
            ) ?? renderPackToggle("research", "Research", "search")}
            {packs.research && (
              <button
                type="button"
                className={`nav-item ${surface === "rss-reader" ? "active" : ""}`}
                onClick={() => openSurface("rss-reader")}
                title="RSS Reader"
                aria-label="RSS Reader"
              >
                <Icon name="inbox" size={17} />
                <span className="nav-label">RSS Reader</span>
              </button>
            )}
            {renderPackNav(
              "graph",
              "Graph",
              "pageGraph",
              () => openSurface("graph"),
              surface === "graph",
            ) ?? renderPackToggle("graph", "Graph", "pageGraph")}
            {renderPackNav(
              "health",
              "Health",
              "heart",
              () => openSurface("personal-health"),
              surface === "personal-health",
            ) ?? renderPackToggle("health", "Health", "heart")}
            {renderPackNav(
              "equity",
              "Equity Research",
              "table",
              () => openSurface("equity"),
              surface === "equity",
            ) ?? renderPackToggle("equity", "Equity", "table")}
            {renderPackNav(
              "content",
              "Content Studio",
              "text",
              () => openSurface("contentStudio"),
              surface === "contentStudio",
            ) ?? renderPackToggle("content", "Content", "text")}
            {renderPackNav(
              "deck",
              "Deck Studio",
              "board",
              () => openSurface("deckStudio"),
              surface === "deckStudio",
            ) ?? renderPackToggle("deck", "Deck", "board")}
            {packs.obsidian ? (
              <div className="sec-group mt-4">
                <div className="sec sec-static">
                  <span className="sec-label">Obsidian</span>
                  <button
                    type="button"
                    className="nav-add"
                    title="Disable Obsidian pack"
                    aria-label="Disable Obsidian pack"
                    onClick={() => setPackEnabled("obsidian", false)}
                  >
                    <Icon name="x" size={13} />
                  </button>
                </div>
                <ObsidianExplorer />
              </div>
            ) : (
              renderPackToggle("obsidian", "Obsidian", "file")
            )}
          </div>
        )}

        <div className="sec sec-static mt-12">
          <span className="sec-label">More</span>
        </div>
        <button
          type="button"
          className={`nav-item ${surface === "journal" ? "active" : ""}`}
          onClick={() => openJournal()}
          title="Journal"
          aria-label="Journal"
        >
          <Icon name="calendar" size={17} />
          <span className="nav-label">Journal</span>
        </button>
        <button
          type="button"
          className="nav-item"
          onClick={() => setTrashOpen(true)}
          title="Trash"
          aria-label="Trash"
        >
          <Icon name="trash" size={17} />
          <span className="nav-label">Trash</span>
        </button>
      </div>

      <StatusChip />

      <div className="rail-foot" ref={profileMenuRef}>
        <button
          ref={profileButtonRef}
          type="button"
          className="rail-profile-button"
          title={isIconsMode ? identity.user : undefined}
          aria-label="Open profile menu"
          aria-haspopup="menu"
          aria-expanded={profileMenuOpen}
          onClick={() => setProfileMenuOpen((open) => !open)}
        >
          <span className="avatar">{identity.initial}</span>
          <span className="rail-foot-name">
            {identity.user}
            <small>SPS</small>
          </span>
          <Icon className="rail-profile-chevron" name="chevD" size={14} />
        </button>
        {profileMenuOpen && (
          <div
            className="rail-profile-menu"
            role="menu"
            aria-label="Profile menu"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setTweaksOpen(!tweaksOpen);
                setProfileMenuOpen(false);
              }}
            >
              <Icon name="sun" size={16} />
              Workspace appearance
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                openSettings();
                setProfileMenuOpen(false);
              }}
            >
              <Icon name="settings" size={16} />
              Settings
              <span className="rail-profile-shortcut">⌘,</span>
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
