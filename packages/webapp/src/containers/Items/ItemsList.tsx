// @ts-nocheck
import React from 'react';
import { compose } from '@/utils';

import '@/style/pages/Items/List.scss';

import { DashboardPageContent } from '@/components';
import { ItemsListProvider } from './ItemsListProvider';

import { ItemsActionsBar } from './ItemsActionsBar';
import { ItemsDataTable } from './ItemsDataTable';
import { ItemsListDrawers } from './ItemsListDrawers';
import { ItemsListDialogs } from './ItemsListDialogs';

import { withItems } from './withItems';
import { withItemsActions } from './withItemsActions';

/**
 * Items list.
 */
function ItemsListInner({
  // #withItems
  itemsTableState,
  itemsTableStateChanged,

  // #withItemsActions
  resetItemsTableState,
}) {
  // Resets items table query state once the page unmount.
  React.useEffect(
    () => () => {
      resetItemsTableState();
    },
    [resetItemsTableState],
  );

  return (
    <ItemsListProvider
      tableState={itemsTableState}
      tableStateChanged={itemsTableStateChanged}
    >
      <ItemsActionsBar />
      <ItemsListDrawers />
      <ItemsListDialogs />

      <DashboardPageContent>
        <ItemsDataTable />
      </DashboardPageContent>
    </ItemsListProvider>
  );
}

export const ItemsList = compose(
  withItemsActions,
  withItems(({ itemsTableState, itemsTableStateChanged }) => ({
    itemsTableState,
    itemsTableStateChanged,
  })),
)(ItemsListInner);
