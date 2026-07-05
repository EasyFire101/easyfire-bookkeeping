// @ts-nocheck
import React from 'react';
import { WarehousesList, WarehousesSkeleton } from './components';
import { WarehousesEmptyStatus } from './WarehousesEmptyStatus';
import { WarehousesGridItems } from './WarehousesGridItems';
import { useWarehousesContext } from './WarehousesProvider';

/**
 * Warehouses grid.
 */
export function WarehousesGrid() {
  // Retrieve list context.
  const { warehouses, isWarehouesLoading, isEmptyStatus } =
    useWarehousesContext();

  return (
    <React.Fragment>
      <WarehousesList>
        {isWarehouesLoading ? (
          <WarehousesSkeleton />
        ) : isEmptyStatus ? (
          <WarehousesEmptyStatus />
        ) : (
          <WarehousesGridItems warehouses={warehouses} />
        )}
      </WarehousesList>
    </React.Fragment>
  );
}
