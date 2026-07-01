import React, { useCallback } from 'react';
import { Alignment, Navbar, NavbarGroup } from '@blueprintjs/core';
import intl from 'react-intl-universal';
import { DashboardViewsTabs } from '@/components';
import { useAccountsChartContext } from './AccountsChartProvider';
import { withAccounts } from './withAccounts';
import type { WithAccountsProps } from './withAccounts';
import { withAccountsTableActions } from './withAccountsTableActions';
import { compose, transfromViewsToTabs } from '@/utils';
import type { WithAccountsTableActionsProps } from './withAccountsTableActions';

interface AccountsViewsTabsInnerProps extends WithAccountsTableActionsProps {
  accountsCurrentView: WithAccountsProps['accountsTableState']['viewSlug'];
}

/**
 * Accounts views tabs.
 */
function AccountsViewsTabsInner({
  // #withAccountsTableActions
  setAccountsTableState,

  // #withAccounts
  accountsCurrentView,
}: AccountsViewsTabsInnerProps) {
  // Accounts chart context.
  const { resourceViews } = useAccountsChartContext();

  // Handles the tab change.
  const handleTabChange = useCallback(
    (viewSlug: string) => {
      setAccountsTableState({
        viewSlug: viewSlug || (null as unknown as string),
      });
    },
    [setAccountsTableState],
  );

  // Transfromes the accounts views to tabs.
  // `transfromViewsToTabs` is untyped; surface as `unknown[]` to keep the
  // DashboardViewsTabs consumer happy.
  const tabs = transfromViewsToTabs(resourceViews) as unknown[];

  return (
    <Navbar className="navbar--dashboard-views">
      <NavbarGroup align={Alignment.LEFT}>
        <DashboardViewsTabs
          // `defaultTabText` is typed as `Element` but the original passes a
          // string from intl.get — preserved latent bug.
          // @ts-expect-error see comment above
          defaultTabText={intl.get('all_accounts_')}
          currentViewSlug={accountsCurrentView}
          resourceName={'accounts'}
          onChange={handleTabChange}
          tabs={tabs}
        />
      </NavbarGroup>
    </Navbar>
  );
}

export const AccountsViewsTabs = compose(
  withAccountsTableActions,
  withAccounts(({ accountsTableState }) => ({
    accountsCurrentView: accountsTableState.viewSlug,
  })),
)(AccountsViewsTabsInner);
