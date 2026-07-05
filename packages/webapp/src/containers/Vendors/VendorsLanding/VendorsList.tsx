// @ts-nocheck
import React, { useEffect } from 'react';

import '@/style/pages/Vendors/List.scss';

import { VendorActionsBar } from './VendorActionsBar';
import { VendorsListDialogs } from './VendorsListDialogs';
import { VendorsListProvider } from './VendorsListProvider';
import { VendorsTable } from './VendorsTable';
import { withVendors } from './withVendors';
import { withVendorsActions } from './withVendorsActions';
import { DashboardPageContent } from '@/components';
import { compose } from '@/utils';


/**
 * Vendors list page.
 */
function VendorsListInner({
  // #withVendors
  vendorsTableState,
  vendorsTableStateChanged,

  // #withVendorsActions
  resetVendorsTableState,
  resetVendorsSelectedRows,
}) {
  // Resets the vendors table state once the page unmount.
  useEffect(
    () => () => {
      resetVendorsTableState();
      resetVendorsSelectedRows();
    },
    [resetVendorsSelectedRows, resetVendorsTableState],
  );

  return (
    <VendorsListProvider
      tableState={vendorsTableState}
      tableStateChanged={vendorsTableStateChanged}
    >
      <VendorActionsBar />
      <VendorsListDialogs />

      <DashboardPageContent>
        <VendorsTable />
      </DashboardPageContent>
    </VendorsListProvider>
  );
}

export const VendorsList = compose(
  withVendors(({ vendorsTableState, vendorsTableStateChanged }) => ({
    vendorsTableState,
    vendorsTableStateChanged,
  })),
  withVendorsActions,
)(VendorsListInner);
