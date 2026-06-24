import { BillBulkDeleteDialog } from '@/containers/Dialogs/Bills/BillBulkDeleteDialog';
import { DialogsName } from '@/constants/dialogs';

export function BillsListDialogs() {
  return (
    <>
      <BillBulkDeleteDialog dialogName={DialogsName.BillBulkDelete} />
    </>
  );
}
