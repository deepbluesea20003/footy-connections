export type TabId = "game" | "connections" | "explorer";

interface Tab {
  id: TabId;
  label: string;
  icon: string; // emoji glyph
}

const TABS: Tab[] = [
  { id: "game", label: "Play", icon: "🎮" },
  { id: "connections", label: "Connect", icon: "🔗" },
  { id: "explorer", label: "Explore", icon: "🕸️" },
];

interface Props {
  active: TabId;
  onChange: (id: TabId) => void;
}

export function TabBar({ active, onChange }: Props) {
  return (
    <nav className="mx-auto w-full max-w-md">
      <div className="glass rounded-2xl p-1.5 flex gap-1">
        {TABS.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              aria-current={isActive ? "page" : undefined}
              className={`relative flex-1 flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all ${
                isActive
                  ? "bg-gradient-to-r from-turf to-electric text-[#04130c] shadow-[0_8px_24px_-10px_rgba(21,224,129,0.8)]"
                  : "text-kit-gray hover:text-kit-white hover:bg-pitch-lighter/60"
              }`}
            >
              <span aria-hidden="true">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
