// @ts-nocheck
import React from 'react';

import '@/style/pages/InventoryAdjustments/List.scss';

import { DashboardContentTable, DashboardPageContent } from '@/components';

import { InventoryAdjustmentsProvider } from './InventoryAdjustmentsProvider';
import { InventoryAdjustmentTable } from './InventoryAdjustmentTable';
import { InventoryAdjustmentListDrawers } from './InventoryAdjustmentListDrawers';

import { withInventoryAdjustments } from './withInventoryAdjustments';

import { compose, transformTableStateToQuery } from '@/utils';

/**
 * Inventory Adjustment List.
 */
function InventoryAdjustmentListInner({
  // #withInventoryAdjustments
  inventoryAdjustmentTableState,
}) {
  return (
    <InventoryAdjustmentsProvider
      query={transformTableStateToQuery(inventoryAdjustmentTableState)}
    >
      <InventoryAdjustmentListDrawers />

      <DashboardPageContent>
        <DashboardContentTable>
          <InventoryAdjustmentTable />
        </DashboardContentTable>
      </DashboardPageContent>
    </InventoryAdjustmentsProvider>
  );
}

export const InventoryAdjustmentList = compose(
  withInventoryAdjustments(({ inventoryAdjustmentTableState }) => ({
    inventoryAdjustmentTableState,
  })),
)(InventoryAdjustmentListInner);
