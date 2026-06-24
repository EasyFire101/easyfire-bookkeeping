import { ManualJournalBulkDeleteDialog } from '@/containers/Dialogs/ManualJournals/ManualJournalBulkDeleteDialog';
import { DialogsName } from '@/constants/dialogs';

export function ManualJournalsListDialogs() {
  return (
    <>
      <ManualJournalBulkDeleteDialog
        dialogName={DialogsName.ManualJournalBulkDelete}
      />
    </>
  );
}
