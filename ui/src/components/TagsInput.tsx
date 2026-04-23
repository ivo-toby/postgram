import { useCallback, useState, type KeyboardEvent } from 'react';

type Props = {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
};

export default function TagsInput({ value, onChange, placeholder }: Props) {
  const [input, setInput] = useState('');

  const addTag = useCallback((raw: string) => {
    const tag = raw.trim().replace(/,$/, '').trim();
    if (!tag) return;
    if (value.includes(tag)) {
      setInput('');
      return;
    }
    onChange([...value, tag]);
    setInput('');
  }, [value, onChange]);

  const removeTag = useCallback((tag: string) => {
    onChange(value.filter(t => t !== tag));
  }, [value, onChange]);

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag(input);
    } else if (e.key === 'Backspace' && !input && value.length > 0) {
      removeTag(value[value.length - 1]!);
    }
  };

  return (
    <div className="flex flex-wrap gap-1 items-center bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 focus-within:ring-1 focus-within:ring-blue-500">
      {value.map(tag => (
        <span key={tag} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-700 text-gray-100">
          {tag}
          <button
            type="button"
            onClick={() => removeTag(tag)}
            className="text-gray-400 hover:text-white"
            aria-label={`Remove ${tag}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={e => {
          const v = e.target.value;
          if (v.endsWith(',')) addTag(v);
          else setInput(v);
        }}
        onKeyDown={handleKey}
        onBlur={() => addTag(input)}
        placeholder={value.length === 0 ? (placeholder ?? 'Add tag…') : ''}
        className="flex-1 min-w-[80px] bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none py-0.5"
      />
    </div>
  );
}
