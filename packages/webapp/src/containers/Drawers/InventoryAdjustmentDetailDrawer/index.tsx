// @ts-nocheck
import React from 'react';

import { Drawer, DrawerSuspense } from '@/components';
import { withDrawers } from '@/containers/Drawer/withDrawers';

import { compose } from '@/utils';

const InventoryAdjustmentDrawerContent = React.lazy(() => import('./InventoryAdjustmentDrawerContent').then(m => ({ default: m.InventoryAdjustmentDrawerContent })));

/**
 * Inventory adjustment detail drawer.
 */
function InventoryAdjustmentDetailDrawer({
  name,
  // #withDrawer
  isOpen,
  payload: { inventoryId },
}) {
  return (
    <Drawer
      isOpen={isOpen}
      name={name}
      style={{ minWidth: '700px', maxWidth: '900px' }}
      size={'65%'}
    >
      <DrawerSuspense>
        <InventoryAdjustmentDrawerContent inventoryId={inventoryId} />
      </DrawerSuspense>
    </Drawer>
  );
}

export const index = compose(withDrawers())(InventoryAdjustmentDetailDrawer);
