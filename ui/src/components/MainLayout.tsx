import type { ReactNode } from 'react';
import TopBar from './TopBar.tsx';
import LeftPanel from './LeftPanel.tsx';
import RightPanel from './RightPanel.tsx';

type Props = {
  onLogout: () => void;
  leftContent: ReactNode;
  graphContent: ReactNode;
  rightOpen: boolean;
  onRightClose: () => void;
  rightContent: ReactNode;
};

export default function MainLayout({
  onLogout,
  leftContent,
  graphContent,
  rightOpen,
  onRightClose,
  rightContent,
}: Props) {
  return (
    <div className="flex flex-col h-full bg-gray-950">
      <TopBar onLogout={onLogout} />
      <div className="flex flex-1 min-h-0">
        <LeftPanel>{leftContent}</LeftPanel>
        <main className="flex-1 relative min-w-0">{graphContent}</main>
        <RightPanel open={rightOpen} onClose={onRightClose}>
          {rightContent}
        </RightPanel>
      </div>
    </div>
  );
}
