// @ts-nocheck
import React from 'react';

import '@/style/pages/Warehouses/warehouseFormDialog.scss';
import { WarehouseFormProvider } from './WarehouseFormProvider';
import { WarehouseForm } from './WarehouseForm';

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
