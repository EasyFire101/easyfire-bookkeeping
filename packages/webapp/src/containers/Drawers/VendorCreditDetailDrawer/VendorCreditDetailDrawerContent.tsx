import React from 'react';
import { DrawerBody } from '@/components';
import { VendorCreditDetail } from './VendorCreditDetail';
import { VendorCreditDetailDrawerProvider } from './VendorCreditDetailDrawerProvider';

interface VendorCreditDetailDrawerContentProps {
  vendorCreditId: number | undefined;
}

/**
 * Vendor credit detail drawer content.
 */
export function VendorCreditDetailDrawerContent({
  vendorCreditId,
}: VendorCreditDetailDrawerContentProps) {
  return (
    <VendorCreditDetailDrawerProvider vendorCreditId={vendorCreditId}>
      <DrawerBody>
        <VendorCreditDetail />
      </DrawerBody>
    </VendorCreditDetailDrawerProvider>
  );
}
