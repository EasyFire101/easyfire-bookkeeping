import React from 'react';
import { DrawerBody } from '@/components';

import { BillDrawerProvider } from './BillDrawerProvider';
import { BillDetails as BillDrawerDetails } from './BillDrawerDetails';

interface BillDrawerContentProps {
  billId: number | undefined;
}

/**
 * Bill drawer content.
 */
export function BillDrawerContent({ billId }: BillDrawerContentProps) {
  return (
    <BillDrawerProvider billId={billId}>
      <DrawerBody>
        <BillDrawerDetails />
      </DrawerBody>
    </BillDrawerProvider>
  );
}
