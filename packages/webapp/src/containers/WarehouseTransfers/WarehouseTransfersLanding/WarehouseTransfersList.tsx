// @ts-nocheck
import React from 'react';
import { DashboardPageContent } from '@/components';
import { WarehouseTransfersActionsBar } from './WarehouseTransfersActionsBar';
import { WarehouseTransfersDataTable } from './WarehouseTransfersDataTable';
import { withWarehouseTransfers } from './withWarehouseTransfers';
import { withWarehouseTransfersActions } from './withWarehouseTransfersActions';
import { WarehouseTransfersListProvider } from './WarehouseTransfersListProvider';
import { WarehouseTransfersListDrawers } from './WarehouseTransfersListDrawers';
import { transformTableStateToQuery, compose } from '@/utils';

function WarehouseTransfersListInner({
  // #withWarehouseTransfers
  warehouseTransferTableState,
  warehouseTransferTableStateChanged,

  // #withWarehouseTransfersActions
  resetWarehouseTransferTableState,
}) {
  // Resets the warehouse transfer table state once the page unmount.
  React.useEffect(
    () => () => {
      resetWarehouseTransferTableState();
    },
    [resetWarehouseTransferTableState],
  );

  return (
    <WarehouseTransfersListProvider
      query={transformTableStateToQuery(warehouseTransferTableState)}
      tableStateChanged={warehouseTransferTableStateChanged}
    >
      <WarehouseTransfersActionsBar />
      <WarehouseTransfersListDrawers />

      <DashboardPageContent>
        <WarehouseTransfersDataTable />
      </DashboardPageContent>
    </WarehouseTransfersListProvider>
  );
}

export const WarehouseTransfersList = compose(
  withWarehouseTransfersActions,
  withWarehouseTransfers(
    ({ warehouseTransferTableState, warehouseTransferTableStateChanged }) => ({
      warehouseTransferTableState,
      warehouseTransferTableStateChanged,
    }),
  ),
)(WarehouseTransfersListInner);
