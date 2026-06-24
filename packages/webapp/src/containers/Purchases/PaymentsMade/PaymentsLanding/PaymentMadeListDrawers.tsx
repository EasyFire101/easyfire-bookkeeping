import { index as PaymentMadeDetailDrawer } from '@/containers/Drawers/PaymentMadeDetailDrawer';
import { DRAWERS } from '@/constants/drawers';

export function PaymentMadeListDrawers() {
  return (
    <>
      <PaymentMadeDetailDrawer name={DRAWERS.PAYMENT_MADE_DETAILS} />
    </>
  );
}
