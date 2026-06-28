import React from 'react';

import { DrawerBody } from '@/components';
import { InventoryAdjustmentDrawerProvider } from './InventoryAdjustmentDrawerProvider';
import { InventoryAdjustmentDetail } from './InventoryAdjustmentDetail';

interface InventoryAdjustmentDrawerContentProps {
  inventoryId: number | undefined;
}

/**
 * Inventory adjustment drawer content.
 */
export function InventoryAdjustmentDrawerContent({
  inventoryId,
}: InventoryAdjustmentDrawerContentProps) {
  return (
    <InventoryAdjustmentDrawerProvider inventoryId={inventoryId}>
      <DrawerBody>
        <InventoryAdjustmentDetail />
      </DrawerBody>
    </InventoryAdjustmentDrawerProvider>
  );
}
