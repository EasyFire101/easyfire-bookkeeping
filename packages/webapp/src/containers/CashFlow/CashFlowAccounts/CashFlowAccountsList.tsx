// @ts-nocheck
import React, { useEffect } from 'react';
import { compose } from 'lodash/fp';
import '@/style/pages/CashFlow/CashFlowAccounts/List.scss';
import { DashboardPageContent } from '@/components';
import { CashFlowAccountsProvider } from './CashFlowAccountsProvider';
import { CashflowAccountsGrid } from './CashflowAccountsGrid';
import { CashFlowAccountsActionsBar } from './CashFlowAccountsActionsBar';
import { CashflowAccountsPlaidLink } from './CashflowAccountsPlaidLink';
import { CashflowAccountsLoadingBar } from './CashFlowAccountsLoadingBar';
import { withCashflowAccounts } from '@/containers/CashFlow/AccountTransactions/withCashflowAccounts';
import { withCashflowAccountsTableActions } from '@/containers/CashFlow/AccountTransactions/withCashflowAccountsTableActions';
import { CashFlowDrawers } from '@/containers/CashFlow/CashFlowDrawers';

/**
 * Cashflow accounts list.
 */
function CashFlowAccountsListInner({
  // #withCashflowAccounts
  cashflowAccountsTableState,

  // #withCashflowAccountsTableActions
  resetCashflowAccountsTableState,
}) {
  // Resets the cashflow accounts table state.
  useEffect(
    () => () => {
      resetCashflowAccountsTableState();
    },
    [resetCashflowAccountsTableState],
  );

  return (
    <CashFlowAccountsProvider tableState={cashflowAccountsTableState}>
      <CashFlowDrawers />
      <CashFlowAccountsActionsBar />
      <CashflowAccountsLoadingBar />

      <DashboardPageContent>
        <CashflowAccountsGrid />
      </DashboardPageContent>

      <CashflowAccountsPlaidLink />
    </CashFlowAccountsProvider>
  );
}

export const CashFlowAccountsList = compose(
  withCashflowAccounts(({ cashflowAccountsTableState }) => ({
    cashflowAccountsTableState,
  })),
  withCashflowAccountsTableActions,
)(CashFlowAccountsListInner);
