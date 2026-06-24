import React, { useEffect } from 'react';
import '@/style/pages/Expense/List.scss';
import { DashboardPageContent } from '@/components';
import { ExpenseActionsBar } from './ExpenseActionsBar';
import { ExpenseDataTable } from './ExpenseDataTable';
import { withExpenses } from './withExpenses';
import { withExpensesActions } from './withExpensesActions';
import { compose, transformTableStateToQuery } from '@/utils';
import { ExpensesListProvider } from './ExpensesListProvider';
import { ExpensesListDrawers } from './ExpensesListDrawers';
import { ExpensesListDialogs } from './ExpensesListDialogs';
import type { WithExpensesProps } from './withExpenses';
import type { WithExpensesActionsProps } from './withExpensesActions';

interface ExpensesListInnerProps
  extends Pick<
      WithExpensesProps,
      'expensesTableState' | 'expensesTableStateChanged'
    >,
    Pick<WithExpensesActionsProps, 'resetExpensesTableState'> {}

/**
 * Expenses list.
 */
function ExpensesListInner({
  // #withExpenses
  expensesTableState,
  expensesTableStateChanged,

  // #withExpensesActions
  resetExpensesTableState,
}: ExpensesListInnerProps) {
  // Resets the expenses table state once the page unmount.
  useEffect(
    () => () => {
      resetExpensesTableState();
    },
    [resetExpensesTableState],
  );

  return (
    <ExpensesListProvider
      query={transformTableStateToQuery(expensesTableState)}
      tableStateChanged={expensesTableStateChanged}
    >
      <ExpenseActionsBar />
      <ExpensesListDrawers />
      <ExpensesListDialogs />

      <DashboardPageContent>
        <ExpenseDataTable />
      </DashboardPageContent>
    </ExpensesListProvider>
  );
}

export const ExpensesList = compose(
  withExpenses(({ expensesTableState, expensesTableStateChanged }) => ({
    expensesTableState,
    expensesTableStateChanged,
  })),
  withExpensesActions,
)(ExpensesListInner);
