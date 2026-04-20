export type Page = 'search' | 'graph';

type Props = {
  onLogout: () => void;
  currentPage: Page;
  onNavigate: (page: Page) => void;
};

export default function TopBar({ onLogout, currentPage, onNavigate }: Props) {
  return (
    <header className="flex items-center gap-2 sm:gap-4 px-3 sm:px-4 h-12 bg-gray-900 border-b border-gray-800 shrink-0">
      <span className="text-white font-semibold text-sm tracking-wide">Postgram</span>
      <nav className="flex items-center gap-1 ml-2 sm:ml-4">
        <TabButton active={currentPage === 'search'} onClick={() => onNavigate('search')}>Search</TabButton>
        <TabButton active={currentPage === 'graph'} onClick={() => onNavigate('graph')}>Graph</TabButton>
      </nav>
      <div className="flex-1" />
      <button
        onClick={onLogout}
        className="text-xs text-gray-400 hover:text-white transition-colors"
      >
        Logout
      </button>
    </header>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-md text-sm transition-colors ${
        active ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
      }`}
    >
      {children}
    </button>
  );
}
