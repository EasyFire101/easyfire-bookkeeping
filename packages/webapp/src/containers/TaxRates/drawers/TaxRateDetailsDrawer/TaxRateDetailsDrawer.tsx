// @ts-nocheck
import * as R from 'ramda';
import React from 'react';
import { Drawer, DrawerHeaderContent, DrawerSuspense } from '@/components';
import { DRAWERS } from '@/constants/drawers';
import { withDrawers } from '@/containers/Drawer/withDrawers';

const TaxRateDetailsDrawerContent = React.lazy(() =>
  import('./TaxRateDetailsContent').then((m) => ({
    default: m.TaxRateDetailsContent,
  })),
);

/**
 * Tax rate details drawer.
 */
function TaxRateDetailsDrawerInner({
  name,
  // #withDrawer
  isOpen,
  payload: { taxRateId },
}) {
  return (
    <Drawer
      isOpen={isOpen}
      name={name}
      style={{ minWidth: '650px', maxWidth: '650px' }}
      size={'65%'}
    >
      <DrawerSuspense>
        <TaxRateDetailsDrawerContent name={name} taxRateId={taxRateId} />
      </DrawerSuspense>
    </Drawer>
  );
}

export const TaxRateDetailsDrawer = R.compose(withDrawers())(
  TaxRateDetailsDrawerInner,
);
