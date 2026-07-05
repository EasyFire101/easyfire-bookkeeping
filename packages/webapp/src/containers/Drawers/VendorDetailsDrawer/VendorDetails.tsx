// @ts-nocheck
import clsx from 'classnames';
import React from 'react';
import { VendorDetailsActionsBar } from './VendorDetailsActionsBar';
import Style from './VendorDetailsDrawer.module.scss';
import { VendorDetailsHeader } from './VendorDetailsHeader';
import { Card } from '@/components';


/**
 * contact detail.
 */
export function CustomerDetails() {
  return (
    <div className={clsx(Style.root)}>
      <VendorDetailsActionsBar />

      <Card>
        <VendorDetailsHeader />
      </Card>
    </div>
  );
}
