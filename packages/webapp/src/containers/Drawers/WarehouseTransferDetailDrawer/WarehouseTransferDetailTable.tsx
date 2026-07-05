// @ts-nocheck
import React from 'react';
import { useWarehouseTransferReadOnlyEntriesColumns } from './utils';
import { useWarehouseDetailDrawerContext } from './WarehouseTransferDetailDrawerProvider';
import { CommercialDocEntriesTable } from '@/components';
import { TableStyle } from '@/constants';

/**
 * Warehouse transfer detail table.
 * @returns {React.JSX}
 */
export function WarehouseTransferDetailTable() {
  // Warehouse transfer entries table columns.
  const columns = useWarehouseTransferReadOnlyEntriesColumns();

  const {
    warehouseTransfer: { entries },
  } = useWarehouseDetailDrawerContext();

  return (
    <CommercialDocEntriesTable
      columns={columns}
      data={entries}
      styleName={TableStyle.Constrant}
    />
  );
}
