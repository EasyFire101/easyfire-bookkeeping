import React from 'react';
import { CommercialDocEntriesTable } from '@/components';
import { useInventoryAdjustmentEntriesColumns } from './utils';
import { useInventoryAdjustmentDrawerContext } from './InventoryAdjustmentDrawerProvider';

/**
 * Inventory adjustment detail entries table.
 */
export function InventoryAdjustmentDetailTable() {
  const columns = useInventoryAdjustmentEntriesColumns();
  const { inventoryAdjustment } = useInventoryAdjustmentDrawerContext();

  return (
    <CommercialDocEntriesTable
      columns={columns}
      data={inventoryAdjustment?.entries ?? []}
      className={'table-constrant'}
    />
  );
}
