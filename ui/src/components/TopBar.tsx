import { useEffect, useRef } from 'react';

export type Page = 'search' | 'graph' | 'projector' | 'tasks' | 'where' | 'admin';

type Props = {
  onLogout: () => void;
  currentPage: Page;
  onNavigate: (page: Page) => void;
};

export default function TopBar({ onLogout, currentPage, onNavigate }: Props) {
  const navRef = useRef<HTMLElement>(null);

  // On a narrow screen the tabs can scroll; keep the active one in view.
  useEffect(() => {
    const active = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [currentPage]);

  return (
    <header className="flex items-center gap-1.5 sm:gap-4 px-2 sm:px-4 h-12 bg-gray-900 border-b border-gray-800 shrink-0">
      <div className="flex items-center gap-2">
        <img src="/logo-mark.png" alt="" className="h-6 w-6 sm:h-7 sm:w-7" />
        <span className="hidden sm:inline text-white font-semibold text-sm tracking-wide">Postgram</span>
      </div>
      <nav ref={navRef} className="flex items-center gap-0.5 sm:gap-1 sm:ml-4 min-w-0 overflow-x-auto [scrollbar-width:none]">
        <TabButton active={currentPage === 'search'} onClick={() => onNavigate('search')}>Search</TabButton>
        <TabButton active={currentPage === 'graph'} onClick={() => onNavigate('graph')}>Graph</TabButton>
        <TabButton active={currentPage === 'projector'} onClick={() => onNavigate('projector')}>Projector</TabButton>
        <TabButton active={currentPage === 'tasks'} onClick={() => onNavigate('tasks')}>Tasks</TabButton>
        <TabButton active={currentPage === 'where'} onClick={() => onNavigate('where')}>Where</TabButton>
        <TabButton active={currentPage === 'admin'} onClick={() => onNavigate('admin')}>Admin</TabButton>
      </nav>
      <div className="flex-1" />
      <button
        onClick={onLogout}
        aria-label="Logout"
        title="Logout"
        className="shrink-0 text-xs text-gray-400 hover:text-white transition-colors"
      >
        <span className="hidden sm:inline">Logout</span>
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4 sm:hidden">
          <path d="M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M12 6l4 4-4 4M16 10H8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </header>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`shrink-0 px-1.5 sm:px-3 py-1 rounded-md text-xs sm:text-sm transition-colors ${
        active ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
      }`}
    >
      {children}
    </button>
  );
}
