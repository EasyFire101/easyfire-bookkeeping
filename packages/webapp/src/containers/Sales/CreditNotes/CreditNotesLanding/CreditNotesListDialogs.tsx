import { CreditNoteBulkDeleteDialog } from '@/containers/Dialogs/CreditNotes/CreditNoteBulkDeleteDialog';
import { index as CreditNotePdfPreviewDialog } from '@/containers/Dialogs/CreditNotePdfPreviewDialog';
import { DialogsName } from '@/constants/dialogs';

export function CreditNotesListDialogs() {
  return (
    <>
      <CreditNoteBulkDeleteDialog
        dialogName={DialogsName.CreditNoteBulkDelete}
      />
      <CreditNotePdfPreviewDialog dialogName={DialogsName.CreditNotePdfForm} />
    </>
  );
}
