type Props = {
  onLogout: () => void;
};

export default function TopBar({ onLogout }: Props) {
  return (
    <header className="flex items-center gap-4 px-4 h-12 bg-gray-900 border-b border-gray-800 shrink-0">
      <span className="text-white font-semibold text-sm tracking-wide">Postgram</span>
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
