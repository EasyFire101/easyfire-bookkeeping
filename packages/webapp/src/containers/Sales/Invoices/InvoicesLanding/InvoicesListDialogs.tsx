import { InvoiceBulkDeleteDialog } from '@/containers/Dialogs/Invoices/InvoiceBulkDeleteDialog';
import { index as InvoicePdfPreviewDialog } from '@/containers/Dialogs/InvoicePdfPreviewDialog';
import { DialogsName } from '@/constants/dialogs';

export function InvoicesListDialogs() {
  return (
    <>
      <InvoiceBulkDeleteDialog dialogName={DialogsName.InvoiceBulkDelete} />
      <InvoicePdfPreviewDialog dialogName={DialogsName.InvoicePdfForm} />
    </>
  );
}
