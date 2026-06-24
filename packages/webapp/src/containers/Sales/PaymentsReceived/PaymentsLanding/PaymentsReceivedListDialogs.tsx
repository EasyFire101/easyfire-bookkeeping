import { PaymentReceivedBulkDeleteDialog } from '@/containers/Dialogs/PaymentsReceived/PaymentReceivedBulkDeleteDialog';
import { index as PaymentReceivePdfPreviewDialog } from '@/containers/Dialogs/PaymentReceivePdfPreviewDialog';
import { DialogsName } from '@/constants/dialogs';

export function PaymentsReceivedListDialogs() {
  return (
    <>
      <PaymentReceivedBulkDeleteDialog
        dialogName={DialogsName.PaymentReceivedBulkDelete}
      />
      <PaymentReceivePdfPreviewDialog dialogName={DialogsName.PaymentPdfForm} />
    </>
  );
}
