import { ReceiptBulkDeleteDialog } from '@/containers/Dialogs/Receipts/ReceiptBulkDeleteDialog';
import { DialogsName } from '@/constants/dialogs';

export function ReceiptsListDialogs() {
  return (
    <>
      <ReceiptBulkDeleteDialog dialogName={DialogsName.ReceiptBulkDelete} />
    </>
  );
}
