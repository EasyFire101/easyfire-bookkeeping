import { useEffect } from 'react';
import '@/style/pages/Accounts/List.scss';
import { DashboardPageContent, DashboardContentTable } from '@/components';
import { AccountsChartProvider } from './AccountsChartProvider';
import { AccountsActionsBar } from './AccountsActionsBar';
import { AccountsDataTable } from './AccountsDataTable';
import { AccountsChartDrawers } from './AccountsChartDrawers';
import { AccountsChartDialogs } from './AccountsChartDialogs';
import { withAccounts } from '@/containers/Accounts/withAccounts';
import { withAccountsTableActions } from './withAccountsTableActions';
import { transformAccountsStateToQuery } from './utils';
import { compose } from '@/utils';
import type { WithAccountsProps } from '@/containers/Accounts/withAccounts';
import type { WithAccountsTableActionsProps } from './withAccountsTableActions';

interface AccountsChartInnerProps {
  accountsTableState: WithAccountsProps['accountsTableState'];
  accountsTableStateChanged: WithAccountsProps['accountsTableStateChanged'];
  resetAccountsTableState: WithAccountsTableActionsProps['resetAccountsTableState'];
}

/**
 * Accounts chart list.
 */
function AccountsChartInner({
  accountsTableState,
  accountsTableStateChanged,

  resetAccountsTableState,
}: AccountsChartInnerProps) {
  // Resets the accounts table state once the page unmount.
  useEffect(
    () => () => {
      resetAccountsTableState();
    },
    [resetAccountsTableState],
  );

  return (
    <AccountsChartProvider
      query={transformAccountsStateToQuery(accountsTableState)}
      tableStateChanged={accountsTableStateChanged}
    >
      <AccountsActionsBar />
      <AccountsChartDrawers />
      <AccountsChartDialogs />

      <DashboardPageContent>
        <DashboardContentTable>
          <AccountsDataTable />
        </DashboardContentTable>
      </DashboardPageContent>
    </AccountsChartProvider>
  );
}

export const AccountsChart = compose(
  withAccounts(({ accountsTableState, accountsTableStateChanged }) => ({
    accountsTableState,
    accountsTableStateChanged,
  })),
  withAccountsTableActions,
)(AccountsChartInner);
