import { useEffect, useState } from "react";
import { TabBar, type TabId } from "./components/layout/TabBar";
import { GameTab } from "./components/game/GameTab";
import { ConnectionsTab } from "./components/ConnectionsTab";
import { ExplorerTab } from "./components/ExplorerTab";

const TABS: TabId[] = ["game", "connections", "explorer"];

function tabFromHash(): TabId {
  const id = window.location.hash.replace(/^#\/?/, "") as TabId;
  return TABS.includes(id) ? id : "game";
}

export default function App() {
  const [tab, setTab] = useState<TabId>(tabFromHash);

  // Keep the URL hash and the active tab in sync (shareable deep links).
  useEffect(() => {
    const onHashChange = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  function changeTab(id: TabId) {
    window.location.hash = `/${id}`;
    setTab(id);
  }

  return (
    <div className="min-h-screen px-4 py-8 sm:py-12">
      <header className="text-center mb-8">
        <h1 className="font-display text-3xl sm:text-5xl font-black tracking-tight">
          <span className="text-gradient">Footy</span>
          <span className="text-kit-white"> Connections</span>
        </h1>
        <p className="mt-2 text-kit-gray text-sm">Six degrees of football, through shared teammates.</p>
      </header>

      <div className="mb-10">
        <TabBar active={tab} onChange={changeTab} />
      </div>

      <main className="max-w-5xl mx-auto">
        {tab === "game" && <GameTab />}
        {tab === "connections" && <ConnectionsTab />}
        {tab === "explorer" && <ExplorerTab />}
      </main>
    </div>
  );
}
