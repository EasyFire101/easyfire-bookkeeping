import React from 'react';
import * as R from 'ramda';

import { ButtonLink } from '../Button';
import {
  withDrawerActions,
  WithDrawerActionsProps,
} from '@/containers/Drawer/withDrawerActions';
import { DRAWERS } from '@/constants/drawers';

interface VendorDrawerLinkComponentProps extends WithDrawerActionsProps {
  children?: React.ReactNode;
  vendorId?: number;
  className?: string;
}

function VendorDrawerLinkComponent({
  // #ownProps
  children,
  vendorId,
  className,

  // #withDrawerActions
  openDrawer,
}: VendorDrawerLinkComponentProps) {
  // Handle view customer drawer.
  const handleVendorDrawer = (event: React.MouseEvent) => {
    openDrawer(DRAWERS.VENDOR_DETAILS, { vendorId });
    event.preventDefault();
  };

  return (
    <ButtonLink className={className} onClick={handleVendorDrawer}>
      {children}
    </ButtonLink>
  );
}

export const VendorDrawerLink = R.compose(withDrawerActions)(
  VendorDrawerLinkComponent,
);
