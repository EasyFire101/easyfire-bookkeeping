import React from 'react';

import { DrawerBody } from '@/components';
import { PaymentMadeDetail as PaymentMadeDetails } from './PaymentMadeDetails';
import { PaymentMadeDetailProvider } from './PaymentMadeDetailProvider';

interface PaymentMadeDetailContentProps {
  paymentMadeId: number | undefined;
}

/**
 * Payment made detail content.
 */
export function PaymentMadeDetailContent({
  // #ownProp
  paymentMadeId,
}: PaymentMadeDetailContentProps) {
  return (
    <PaymentMadeDetailProvider paymentMadeId={paymentMadeId}>
      <DrawerBody>
        <PaymentMadeDetails />
      </DrawerBody>
    </PaymentMadeDetailProvider>
  );
}
