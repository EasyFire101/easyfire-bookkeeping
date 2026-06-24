import { index as CreditNoteDetailDrawer } from '@/containers/Drawers/CreditNoteDetailDrawer';
import { DRAWERS } from '@/constants/drawers';

export function CreditNotesListDrawers() {
  return (
    <>
      <CreditNoteDetailDrawer name={DRAWERS.CREDIT_NOTE_DETAILS} />
    </>
  );
}
