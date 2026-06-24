// @ts-nocheck
import React from 'react';
import * as R from 'ramda';

import { ButtonLink } from '../Button';
import {
  withDrawerActions,
  WithDrawerActionsProps,
} from '@/containers/Drawer/withDrawerActions';
import { DRAWERS } from '@/constants/drawers';

interface CustomerDrawerLinkComponentProps extends WithDrawerActionsProps {
  children?: React.ReactNode;
  customerId?: number;
  className?: string;
}

function CustomerDrawerLinkComponent({
  // #ownProps
  children,
  customerId,
  className,

  // #withDrawerActions
  openDrawer,
}: CustomerDrawerLinkComponentProps) {
  // Handle view customer drawer.
  const handleCustomerDrawer = (event: React.MouseEvent) => {
    openDrawer(DRAWERS.CUSTOMER_DETAILS, { customerId });
    event.preventDefault();
  };

  return (
    <ButtonLink className={className} onClick={handleCustomerDrawer}>
      {children}
    </ButtonLink>
  );
}

export const CustomerDrawerLink = R.compose(withDrawerActions)(
  CustomerDrawerLinkComponent,
);
