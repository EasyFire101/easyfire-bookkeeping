// @ts-nocheck
import React from 'react';

import '@/style/pages/Warehouses/warehouseFormDialog.scss';
import { WarehouseForm } from './WarehouseForm';
import { WarehouseFormProvider } from './WarehouseFormProvider';

/**
 * Warehouse form dialog content.
 */
export function WarehouseFormDialogContent({
  // #ownProps
  dialogName,
  warehouseId,
}) {
  return (
    <WarehouseFormProvider warehouseId={warehouseId} dialogName={dialogName}>
      <WarehouseForm />
    </WarehouseFormProvider>
  );
}
