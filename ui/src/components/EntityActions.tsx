import { useState } from 'react';
import type { Entity } from '../lib/types.ts';
import type { ApiClient } from '../lib/api.ts';
import AddNoteModal from './AddNoteModal.tsx';
import LinkModal from './LinkModal.tsx';

type Props = {
  entity: Entity;
  api: ApiClient;
  onDelete: () => void;
  onNoteCreated: (entity: Entity) => void;
  onLinked: () => void;
};

type Modal = 'note' | 'link' | null;

export default function EntityActions({ entity, api, onDelete, onNoteCreated, onLinked }: Props) {
  const [modal, setModal] = useState<Modal>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.deleteEntity(entity.id);
      onDelete();
    } catch (e) {
      console.error(e);
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <button
          onClick={() => setModal('note')}
          className="w-full text-left px-3 py-2 text-sm rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
        >
          + Add note
        </button>
        <button
          onClick={() => setModal('link')}
          className="w-full text-left px-3 py-2 text-sm rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
        >
          Link to entity
        </button>
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="w-full text-left px-3 py-2 text-sm rounded-lg bg-gray-800 hover:bg-red-900 text-gray-500 hover:text-red-400 transition-colors"
          >
            Delete
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex-1 px-3 py-2 text-sm rounded-lg bg-red-700 hover:bg-red-600 text-white disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Confirm delete'}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-3 py-2 text-sm rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {modal === 'note' && (
        <AddNoteModal
          sourceEntityId={entity.id}
          api={api}
          onCreated={onNoteCreated}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'link' && (
        <LinkModal
          sourceEntityId={entity.id}
          api={api}
          onLinked={onLinked}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
