import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, FileText, Network } from "lucide-react";
import { SessionList } from "./SessionList";

interface Props {
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  refreshKey: number;
  onOpenGraph: () => void;
  onOpenNotes: () => void;
}

type SectionId = "agents" | "knowledge";

const STORAGE_PREFIX = "home-ai:sidebar:section:";

// localStorage keys are namespaced so we can add more persisted UI state
// later without colliding. Failures to read/write (Safari private mode,
// quota, disabled storage) fall back to "expanded" — the more informative
// default — and silently swallow write errors.
function loadExpanded(id: SectionId, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + id);
    if (raw === null) return fallback;
    return raw === "1";
  } catch {
    return fallback;
  }
}

function saveExpanded(id: SectionId, expanded: boolean): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + id, expanded ? "1" : "0");
  } catch {
    // ignore — storage quotas / disabled storage shouldn't break the UI
  }
}

export function Sidebar({
  currentSessionId,
  onSelectSession,
  onNewChat,
  refreshKey,
  onOpenGraph,
  onOpenNotes,
}: Props) {
  const [agentsExpanded, setAgentsExpanded] = useState<boolean>(() =>
    loadExpanded("agents", true),
  );
  const [knowledgeExpanded, setKnowledgeExpanded] = useState<boolean>(() =>
    loadExpanded("knowledge", true),
  );

  useEffect(() => {
    saveExpanded("agents", agentsExpanded);
  }, [agentsExpanded]);

  useEffect(() => {
    saveExpanded("knowledge", knowledgeExpanded);
  }, [knowledgeExpanded]);

  return (
    <aside className="hidden lg:flex w-72 shrink-0 flex-col border-r border-zinc-900/80 overflow-hidden">
      <SectionHeader
        label="agents"
        expanded={agentsExpanded}
        onToggle={() => setAgentsExpanded((v) => !v)}
      />
      {agentsExpanded && (
        <SessionList
          currentSessionId={currentSessionId}
          onSelect={onSelectSession}
          onNew={onNewChat}
          refreshKey={refreshKey}
        />
      )}

      <SectionHeader
        label="knowledge"
        expanded={knowledgeExpanded}
        onToggle={() => setKnowledgeExpanded((v) => !v)}
      />
      {knowledgeExpanded && (
        <div className="flex shrink-0 flex-col gap-0.5 px-2 py-2">
          <SidebarButton
            icon={<FileText className="h-3.5 w-3.5 shrink-0 opacity-60" />}
            label="Notes"
            onClick={onOpenNotes}
          />
          <SidebarButton
            icon={<Network className="h-3.5 w-3.5 shrink-0 opacity-60" />}
            label="Knowledge Graph"
            onClick={onOpenGraph}
          />
        </div>
      )}
    </aside>
  );
}

function SectionHeader({
  label,
  expanded,
  onToggle,
}: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="flex w-full shrink-0 items-center gap-1.5 border-b border-zinc-900/80 px-4 py-2.5 text-left transition hover:bg-zinc-900/40"
    >
      {expanded ? (
        <ChevronDown className="h-3 w-3 text-zinc-500" />
      ) : (
        <ChevronRight className="h-3 w-3 text-zinc-500" />
      )}
      <span className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</span>
    </button>
  );
}

function SidebarButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-zinc-400 transition hover:bg-zinc-900/60 hover:text-zinc-200"
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}
