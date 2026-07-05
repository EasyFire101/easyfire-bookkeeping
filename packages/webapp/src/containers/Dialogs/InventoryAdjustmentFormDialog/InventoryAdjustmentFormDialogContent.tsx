// @ts-nocheck
import React from 'react';

import '@/style/pages/Items/ItemAdjustmentDialog.scss';

import { InventoryAdjustmentForm } from './InventoryAdjustmentForm';
import { InventoryAdjustmentFormProvider } from './InventoryAdjustmentFormProvider';

/**
 * Inventory adjustment form dialog content.
 */
export function InventoryAdjustmentFormDialogContent({
  // #ownProps
  dialogName,
  itemId,
}) {
  return (
    <InventoryAdjustmentFormProvider itemId={itemId} dialogName={dialogName}>
      <InventoryAdjustmentForm />
    </InventoryAdjustmentFormProvider>
  );
}
