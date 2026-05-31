// @ts-nocheck
import React from 'react';

import { DrawerBody } from '@/components';
import { PaymentMadeDetail as PaymentMadeDetails } from './PaymentMadeDetails';
import { PaymentMadeDetailProvider } from './PaymentMadeDetailProvider';

/**
 * Payment made detail content.
 */
export function PaymentMadeDetailContent({
  // #ownProp
  paymentMadeId,
}) {
  return (
    <PaymentMadeDetailProvider paymentMadeId={paymentMadeId}>
      <DrawerBody>
        <PaymentMadeDetails />
      </DrawerBody>
    </PaymentMadeDetailProvider>
  );
}
