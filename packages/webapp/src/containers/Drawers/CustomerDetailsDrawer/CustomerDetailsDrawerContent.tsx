// @ts-nocheck
import React from 'react';
import { CustomerDetails } from './CustomerDetails';
import { CustomerDetailsDrawerProvider } from './CustomerDetailsDrawerProvider';
import { DrawerBody } from '@/components';

/**
 * Contact detail drawer content.
 */
export function CustomerDetailsDrawerContent({
  // #ownProp
  customerId,
}) {
  return (
    <CustomerDetailsDrawerProvider customerId={customerId}>
      <DrawerBody>
        <CustomerDetails />
      </DrawerBody>
    </CustomerDetailsDrawerProvider>
  );
}
