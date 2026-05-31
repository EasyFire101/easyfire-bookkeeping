// @ts-nocheck
import React from 'react';

import '@/style/pages/VendorOpeningBalance/VendorOpeningBalance.scss';

import { VendorOpeningBalanceForm } from './VendorOpeningBalanceForm';
import { VendorOpeningBalanceFormProvider } from './VendorOpeningBalanceFormProvider';

/**
 * Vendor Opening balance dialog content.
 * @returns
 */
export function VendorOpeningBalanceDialogContent({
  // #ownProps
  dialogName,
  vendorId,
}) {
  return (
    <VendorOpeningBalanceFormProvider
      vendorId={vendorId}
      dialogName={dialogName}
    >
      <VendorOpeningBalanceForm />
    </VendorOpeningBalanceFormProvider>
  );
}
