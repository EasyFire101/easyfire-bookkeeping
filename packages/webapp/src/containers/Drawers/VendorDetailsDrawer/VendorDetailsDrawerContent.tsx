// @ts-nocheck
import React from 'react';
import { CustomerDetails as VendorDetails } from './VendorDetails';
import { VendorDetailsDrawerProvider } from './VendorDetailsDrawerProvider';
import { DrawerBody } from '@/components';

/**
 * Contact detail drawer content.
 */
export function VendorDetailsDrawerContent({
  // #ownProp
  vendorId,
}) {
  return (
    <VendorDetailsDrawerProvider vendorId={vendorId}>
      <DrawerBody>
        <VendorDetails />
      </DrawerBody>
    </VendorDetailsDrawerProvider>
  );
}
