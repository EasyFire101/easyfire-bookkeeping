// @ts-nocheck
import React from 'react';
import { DrawerHeaderContent, DrawerLoading } from '@/components';
import { DRAWERS } from '@/constants/drawers';
import { useVendor } from '@/hooks/query';

const VendorDetailDrawerContext = React.createContext();

/**
 * Contact detail provider.
 */
function VendorDetailsDrawerProvider({ vendorId, ...props }) {
  // Handle fetch vendor details.
  const { data: vendor, isLoading: isVendorLoading } = useVendor(vendorId, {
    enabled: !!vendorId,
  });
  // Provider.
  const provider = {
    vendor,
    vendorId,
    isVendorLoading,
  };

  return (
    <DrawerLoading loading={isVendorLoading}>
      <DrawerHeaderContent
        name={DRAWERS.VENDOR_DETAILS}
        title={vendor?.display_name}
      />
      <VendorDetailDrawerContext.Provider value={provider} {...props} />
    </DrawerLoading>
  );
}

const useVendorDetailsDrawerContext = () =>
  React.useContext(VendorDetailDrawerContext);

export { VendorDetailsDrawerProvider, useVendorDetailsDrawerContext };
