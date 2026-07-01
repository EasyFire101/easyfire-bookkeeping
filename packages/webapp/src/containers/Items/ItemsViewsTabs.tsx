import React from 'react';
import { Alignment, Navbar, NavbarGroup } from '@blueprintjs/core';
import { DashboardViewsTabs } from '@/components';
import { withRouter } from 'react-router-dom';

import { withItems } from './withItems';
import type { WithItemsProps } from './withItems';
import { withItemsActions } from './withItemsActions';
import type { WithItemsActionsProps } from './withItemsActions';

import { useItemsListContext } from './ItemsListProvider';
import { compose, transfromViewsToTabs } from '@/utils';

interface ItemsViewsTabsInnerProps extends WithItemsActionsProps {
  itemsCurrentView: WithItemsProps['itemsTableState']['viewSlug'];
}

/**
 * Items views tabs.
 */
function ItemsViewsTabsInner({
  // #withItemsActions
  setItemsTableState,

  // #withItems
  itemsCurrentView,
}: ItemsViewsTabsInnerProps) {
  const { itemsViews } = useItemsListContext();

  // Mapped items views.
  const tabs = transfromViewsToTabs(itemsViews) as unknown[];

  // Handles the active tab change.
  const handleTabChange = (viewSlug: string) => {
    setItemsTableState({ viewSlug });
  };

  return (
    <Navbar className="navbar--dashboard-views">
      <NavbarGroup align={Alignment.LEFT}>
        <DashboardViewsTabs
          currentViewSlug={itemsCurrentView}
          resourceName={'items'}
          tabs={tabs}
          onChange={handleTabChange}
        />
      </NavbarGroup>
    </Navbar>
  );
}

export const ItemsViewsTabs = compose(
  withRouter,
  withItems(({ itemsTableState }) => ({
    itemsCurrentView: itemsTableState?.viewSlug,
  })),
  withItemsActions,
)(ItemsViewsTabsInner);
