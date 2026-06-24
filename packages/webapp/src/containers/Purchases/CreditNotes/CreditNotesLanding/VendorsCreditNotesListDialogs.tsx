import { VendorCreditBulkDeleteDialog } from '@/containers/Dialogs/VendorCredits/VendorCreditBulkDeleteDialog';
import { DialogsName } from '@/constants/dialogs';

export function VendorsCreditNotesListDialogs() {
  return (
    <>
      <VendorCreditBulkDeleteDialog
        dialogName={DialogsName.VendorCreditBulkDelete}
      />
    </>
  );
}
