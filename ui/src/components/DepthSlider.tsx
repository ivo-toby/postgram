type Props = {
  value: number;
  onChange: (v: number) => void;
};

export default function DepthSlider({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-400 w-16 shrink-0">Depth: {value}</span>
      <input
        type="range"
        min={1}
        max={3}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 accent-blue-500"
      />
    </div>
  );
}
