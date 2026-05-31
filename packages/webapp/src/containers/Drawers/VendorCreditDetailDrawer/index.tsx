// @ts-nocheck
import React from 'react';
import { Drawer, DrawerSuspense } from '@/components';
import { withDrawers } from '@/containers/Drawer/withDrawers';

import { compose } from '@/utils';

const VendorCreditDetailDrawerContent = React.lazy(() => import('./VendorCreditDetailDrawerContent').then(m => ({ default: m.VendorCreditDetailDrawerContent })));

/**
 * Vendor Credit detail drawer.
 */
function VendorCreditDetailDrawer({
  name,
  // #withDrawer
  isOpen,
  payload: { vendorCreditId },
}) {
  return (
    <Drawer
      isOpen={isOpen}
      name={name}
      style={{ minWidth: '700px', maxWidth: '900px' }}
      size={'65%'}
    >
      <DrawerSuspense>
        <VendorCreditDetailDrawerContent vendorCreditId={vendorCreditId} />
      </DrawerSuspense>
    </Drawer>
  );
}

export const index = compose(withDrawers())(VendorCreditDetailDrawer);
