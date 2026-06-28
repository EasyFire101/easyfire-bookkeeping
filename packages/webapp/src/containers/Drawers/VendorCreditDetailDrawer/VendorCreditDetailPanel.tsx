import { CommercialDocBox } from '@/components';

import { VendorCreditDetailHeader } from './VendorCreditDetailHeader';
import { VendorCreditDetailTable } from './VendorCreditDetailTable';
import { VendorCreditDetailDrawerFooter } from './VendorCreditDetailDrawerFooter';
import { VendorCreditDetailFooter } from './VendorCreditDetailFooter';

/**
 * Vendor credit details panel.
 * @returns {React.JSX}
 */
export function VendorCreditDetailPanel() {
  return (
    <CommercialDocBox>
      <VendorCreditDetailHeader />
      <VendorCreditDetailTable />
      <VendorCreditDetailDrawerFooter />
      <VendorCreditDetailFooter />
    </CommercialDocBox>
  );
}
