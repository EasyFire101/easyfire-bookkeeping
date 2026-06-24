import { index as InvoiceDetailDrawer } from '@/containers/Drawers/InvoiceDetailDrawer';
import { InvoiceSendMailDrawer } from '@/containers/Sales/Invoices/InvoiceSendMailDrawer/InvoiceSendMailDrawer';
import { DRAWERS } from '@/constants/drawers';

export function InvoicesListDrawers() {
  return (
    <>
      <InvoiceDetailDrawer name={DRAWERS.INVOICE_DETAILS} />
      <InvoiceSendMailDrawer name={DRAWERS.INVOICE_SEND_MAIL} />
    </>
  );
}
