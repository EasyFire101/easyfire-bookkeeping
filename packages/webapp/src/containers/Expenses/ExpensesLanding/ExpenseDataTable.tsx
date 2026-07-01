import React, { useCallback } from 'react';
import { useHistory } from 'react-router-dom';

import { compose } from '@/utils';
import { useExpensesListContext } from './ExpensesListProvider';
import { useMemorizedColumnsWidths } from '@/hooks';
import {
  DashboardContentTable,
  DataTable,
  TableSkeletonRows,
  TableSkeletonHeader,
} from '@/components';
import { TABLES } from '@/constants/tables';

import { InvoicesEmptyStatus as ExpensesEmptyStatus } from './ExpensesEmptyStatus';

import { withDashboardActions } from '@/containers/Dashboard/withDashboardActions';
import { withExpensesActions } from './withExpensesActions';
import type { WithExpensesActionsProps } from './withExpensesActions';
import { withAlertActions } from '@/containers/Alert/withAlertActions';
import type { WithAlertActionsProps } from '@/containers/Alert/withAlertActions';
import { withDrawerActions } from '@/containers/Drawer/withDrawerActions';
import type { WithDrawerActionsProps } from '@/containers/Drawer/withDrawerActions';
import { withSettings } from '@/containers/Settings/withSettings';
import { withExpenses } from './withExpenses';
import type { WithExpensesProps } from './withExpenses';

import { ActionsMenu, useExpensesTableColumns } from './components';
import type { ExpenseTableRow } from './components';
import { DRAWERS } from '@/constants/drawers';
import type { TableQuery } from '@/store/store.types';

interface WithSettingsProps {
  expensesTableSize?: string | null;
}

interface ExpensesDataTableProps
  extends WithExpensesActionsProps,
    WithAlertActionsProps,
    WithDrawerActionsProps,
    WithSettingsProps,
    Pick<WithExpensesProps, 'expensesTableState'> {}

/**
 * Expenses datatable.
 */
function ExpensesDataTable({
  // #withExpensesActions
  setExpensesTableState,
  setExpensesSelectedRows,

  // #withDrawerActions
  openDrawer,

  // #withAlertActions
  openAlert,

  // #withSettings
  expensesTableSize,

  // #withExpenses
  expensesTableState,
}: ExpensesDataTableProps) {
  // Expenses list context.
  const {
    expenses,
    pagination,

    isExpensesLoading,
    isExpensesFetching,
    isEmptyStatus,
  } = useExpensesListContext();

  const history = useHistory();

  // Expenses table columns.
  const columns = useExpensesTableColumns();

  // Local storage memorizing columns widths.
  const [initialColumnsWidths, , handleColumnResizing] =
    useMemorizedColumnsWidths(TABLES.EXPENSES);

  // Handle fetch data of manual jouranls datatable.
  const handleFetchData = useCallback(
    ({
      pageIndex,
      pageSize,
      sortBy,
    }: {
      pageIndex: number;
      pageSize: number;
      sortBy: Array<{ id: string; desc: boolean }>;
    }) => {
      // `sortBy` is not on `TableQuery` but the reducer accepts it; preserved
      // from @ts-nocheck original.
      setExpensesTableState({
        pageIndex,
        pageSize,
        sortBy,
      } as Partial<TableQuery>);
    },
    [setExpensesTableState],
  );

  // Handle the expense publish action.
  const handlePublishExpense = (expense: ExpenseTableRow) => {
    openAlert('expense-publish', { expenseId: expense.id });
  };

  // Handle the expense edit action.
  const handleEditExpense = ({ id }: ExpenseTableRow) => {
    history.push(`/expenses/${id}/edit`);
  };

  // Handle the expense delete action.
  const handleDeleteExpense = (expense: ExpenseTableRow) => {
    openAlert('expense-delete', { expenseId: expense.id });
  };

  // Handle view detail expense.
  const handleViewDetailExpense = ({ id }: ExpenseTableRow) => {
    openDrawer(DRAWERS.EXPENSE_DETAILS, {
      expenseId: id,
    });
  };

  // Handle cell click.
  const handleCellClick = (
    cell: { row: { original: ExpenseTableRow } },
    _event: React.MouseEvent,
  ) => {
    openDrawer(DRAWERS.EXPENSE_DETAILS, { expenseId: cell.row.original.id });
  };

  // Handle selected rows change.
  const handleSelectedRowsChange = (
    selectedFlatRows: Array<{ original: ExpenseTableRow }>,
  ) => {
    const selectedIds =
      selectedFlatRows?.map((row) => row.original.id) || [];
    setExpensesSelectedRows(selectedIds);
  };

  // Display empty status instead of the table.
  if (isEmptyStatus) {
    return <ExpensesEmptyStatus />;
  }

  return (
    <DashboardContentTable>
      <DataTable
        columns={columns}
        data={expenses || []}
        loading={isExpensesLoading}
        headerLoading={isExpensesLoading}
        progressBarLoading={isExpensesFetching}
        selectionColumn={true}
        noInitialFetch={true}
        sticky={true}
        onFetchData={handleFetchData}
        pagination={true}
        initialPageSize={expensesTableState?.pageSize ?? 10}
        manualSortBy={true}
        manualPagination={true}
        rowsCount={pagination?.total ?? 0}
        autoResetSortBy={false}
        autoResetPage={false}
        TableLoadingRenderer={TableSkeletonRows}
        TableHeaderSkeletonRenderer={TableSkeletonHeader}
        ContextMenu={ActionsMenu}
        onCellClick={handleCellClick}
        initialColumnsWidths={initialColumnsWidths}
        onColumnResizing={handleColumnResizing}
        onSelectedRowsChange={handleSelectedRowsChange}
        size={expensesTableSize}
        payload={{
          onPublish: handlePublishExpense,
          onDelete: handleDeleteExpense,
          onEdit: handleEditExpense,
          onViewDetails: handleViewDetailExpense,
        }}
      />
    </DashboardContentTable>
  );
}

export const ExpenseDataTable = compose(
  withDashboardActions,
  withAlertActions,
  withDrawerActions,
  withExpensesActions,
  withSettings(({ expenseSettings }) => ({
    expensesTableSize: expenseSettings?.tableSize,
  })),
  withExpenses(({ expensesTableState }) => ({ expensesTableState })),
)(ExpensesDataTable);
