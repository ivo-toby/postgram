import { useState } from 'react';

type Props = {
  id: string;
  className?: string;
};

export default function CopyUuid({ id, className }: Props) {
  const [copied, setCopied] = useState(false);

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <button
      onClick={handleCopy}
      title={`Copy UUID: ${id}`}
      className={`font-mono text-xs cursor-pointer select-none transition-colors ${
        copied ? 'text-green-400' : 'text-gray-500 hover:text-gray-300'
      } ${className ?? ''}`}
    >
      {copied ? 'copied!' : id.slice(0, 8)}
    </button>
  );
}
