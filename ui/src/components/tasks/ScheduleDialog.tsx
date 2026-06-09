import { useState } from 'react';

type Props = {
  open: boolean;
  title: string;
  onCancel: () => void;
  onConfirm: (date: string) => void;
};

export default function ScheduleDialog({ open, title, onCancel, onConfirm }: Props) {
  const [date, setDate] = useState('');

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-800 bg-gray-900 p-4 shadow-2xl">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <label className="mt-4 block text-xs uppercase tracking-wide text-gray-500">
          Schedule date
          <input
            type="date"
            value={date}
            onChange={event => setDate(event.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md px-3 py-2 text-sm text-gray-400 hover:text-white">
            Cancel
          </button>
          <button
            type="button"
            disabled={!date}
            onClick={() => onConfirm(date)}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
          >
            Apply schedule
          </button>
        </div>
      </div>
    </div>
  );
}
