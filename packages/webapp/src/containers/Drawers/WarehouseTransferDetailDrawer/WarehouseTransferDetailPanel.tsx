// @ts-nocheck
import React from 'react';
import { WarehouseTransferDetailHeader } from './WarehouseTransferDetailHeader';
import { WarehouseTransferDetailTable } from './WarehouseTransferDetailTable';
import { CommercialDocBox } from '@/components';

/**
 * Warehouse transfer details panel.
 */
export function WarehouseTransferDetailPanel() {
  return (
    <CommercialDocBox>
      <WarehouseTransferDetailHeader />
      <WarehouseTransferDetailTable />
    </CommercialDocBox>
  );
}
