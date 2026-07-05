// @ts-nocheck
import { Form } from 'formik';
import React from 'react';
import { InventoryAdjustmentFloatingActions } from './InventoryAdjustmentFloatingActions';
import { InventoryAdjustmentFormDialogFields } from './InventoryAdjustmentFormDialogFields';

/**
 * Inventory adjustment form content.
 */
export function InventoryAdjustmentFormContent() {
  return (
    <Form>
      <InventoryAdjustmentFormDialogFields />
      <InventoryAdjustmentFloatingActions />
    </Form>
  );
}
