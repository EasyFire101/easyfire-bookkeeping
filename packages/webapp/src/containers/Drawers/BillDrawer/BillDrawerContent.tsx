// @ts-nocheck
import React from 'react';
import { DrawerBody } from '@/components';

import { BillDrawerProvider } from './BillDrawerProvider';
import { BillDetails as BillDrawerDetails } from './BillDrawerDetails';

/**
 * Bill drawer content.
 */
export function BillDrawerContent({
  // #ownProp
  billId,
}) {
  return (
    <BillDrawerProvider billId={billId}>
      <DrawerBody>
        <BillDrawerDetails />
      </DrawerBody>
    </BillDrawerProvider>
  );
}
