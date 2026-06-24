import { index as VendorCreditDetailDrawer } from '@/containers/Drawers/VendorCreditDetailDrawer';
import { DRAWERS } from '@/constants/drawers';

export function VendorsCreditNotesListDrawers() {
  return (
    <>
      <VendorCreditDetailDrawer name={DRAWERS.VENDOR_CREDIT_DETAILS} />
    </>
  );
}
