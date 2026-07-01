import React from 'react';
import clsx from 'classnames';
import { Intent } from '@blueprintjs/core';
import {
  TableFastCell,
  TableSkeletonRows,
  TableSkeletonHeader,
  TableVirtualizedListRows,
  AppToaster,
} from '@/components';
import { TABLES } from '@/constants/tables';
import { ActionsMenu } from './components';
import { BankAccountDataTable } from '../components/BankAccountDataTable';

import { withSettings } from '@/containers/Settings/withSettings';
import { withBankingActions } from '../../withBankingActions';
import type { WithBankingActionsProps } from '../../withBankingActions';
import { withBanking } from '../../withBanking';
import type { WithBankingProps } from '../../withBanking';

import { useMemorizedColumnsWidths } from '@/hooks';
import { useAccountUncategorizedTransactionsContext } from '../AllTransactionsUncategorizedBoot';
import { useExcludeUncategorizedTransaction } from '@/hooks/query/banking';
import { useAccountUncategorizedTransactionsColumns } from './hooks';
import type { UncategorizedTransactionRow } from './hooks';
import { useAccountTransactionsContext } from '../AccountTransactionsProvider';

import { compose } from '@/utils';
import styles from './AccountTransactionsUncategorizedTable.module.scss';

interface WithSettingsProps {
  cashflowTansactionsTableSize?: string | null;
}

interface AccountTransactionsDataTableProps
  extends WithSettingsProps,
    Pick<
      WithBankingProps,
      'openMatchingTransactionAside' | 'enableMultipleCategorization'
    >,
    Pick<
      WithBankingActionsProps,
      | 'setUncategorizedTransactionIdForMatching'
      | 'setUncategorizedTransactionsSelected'
      | 'addTransactionsToCategorizeSelected'
      | 'setTransactionsToCategorizeSelected'
    > {}

/**
 * Account transactions data table.
 */
function AccountTransactionsDataTable({
  // #withSettings
  cashflowTansactionsTableSize,

  // #withBanking
  enableMultipleCategorization,

  // #withBankingActions
  setUncategorizedTransactionIdForMatching,
  setUncategorizedTransactionsSelected,
  addTransactionsToCategorizeSelected,
  setTransactionsToCategorizeSelected,
}: AccountTransactionsDataTableProps) {
  // Retrieve table columns.
  const columns = useAccountUncategorizedTransactionsColumns();
  const { scrollableRef } = useAccountTransactionsContext();

  // Retrieve list context.
  const {
    uncategorizedTransactions,
    isUncategorizedTransactionsLoading,
    isUncategorizedTransactionFetching,
  } = useAccountUncategorizedTransactionsContext();

  const { mutateAsync: excludeTransaction } =
    useExcludeUncategorizedTransaction();

  // Local storage memorizing columns widths.
  const [initialColumnsWidths, , handleColumnResizing] =
    useMemorizedColumnsWidths(TABLES.UNCATEGORIZED_BANK_TRANSACTION);

  // Handle cell click.
  const handleCellClick = (cell: {
    row: { original: UncategorizedTransactionRow };
  }) => {
    const id = cell.row.original.id;
    if (id == null) return;
    if (enableMultipleCategorization) {
      addTransactionsToCategorizeSelected(id);
    } else {
      setTransactionsToCategorizeSelected([id]);
    }
  };
  // Handles categorize button click.
  const handleCategorizeBtnClick = (
    transaction: UncategorizedTransactionRow,
  ) => {
    if (transaction.id == null) return;
    setUncategorizedTransactionIdForMatching(transaction.id);
  };
  // handles table selected rows change.
  const handleSelectedRowsChange = (
    selected: Array<{ original: UncategorizedTransactionRow }>,
  ) => {
    const transactionIds =
      selected
        ?.map((r) => r.original.id)
        .filter((id): id is number => id != null) ?? [];
    setUncategorizedTransactionsSelected(transactionIds);
  };
  // Handle exclude transaction.
  const handleExcludeTransaction = (
    transaction: UncategorizedTransactionRow,
  ) => {
    if (transaction.id == null) return;
    excludeTransaction(transaction.id)
      .then(() => {
        AppToaster.show({
          intent: Intent.SUCCESS,
          message: 'The bank transaction has been excluded successfully.',
        });
      })
      .catch(() => {
        AppToaster.show({
          intent: Intent.DANGER,
          message: 'Something went wrong.',
        });
      });
  };

  return (
    <BankAccountDataTable
      noInitialFetch={true}
      columns={columns}
      data={uncategorizedTransactions || []}
      sticky={true}
      selectionColumn={true}
      loading={isUncategorizedTransactionsLoading}
      headerLoading={isUncategorizedTransactionsLoading}
      progressBarLoading={isUncategorizedTransactionFetching}
      expandColumnSpace={1}
      expandToggleColumn={2}
      selectionColumnWidth={45}
      TableCellRenderer={TableFastCell}
      TableLoadingRenderer={TableSkeletonRows}
      TableRowsRenderer={TableVirtualizedListRows}
      TableHeaderSkeletonRenderer={TableSkeletonHeader}
      ContextMenu={ActionsMenu}
      onCellClick={handleCellClick}
      // #TableVirtualizedListRows props.
      vListrowHeight={cashflowTansactionsTableSize === 'small' ? 34 : 40}
      vListOverscanRowCount={0}
      initialColumnsWidths={initialColumnsWidths}
      onColumnResizing={handleColumnResizing}
      noResults={
        'There is no uncategorized transactions in the current account.'
      }
      payload={{
        onExclude: handleExcludeTransaction,
        onCategorize: handleCategorizeBtnClick,
      }}
      onSelectedRowsChange={handleSelectedRowsChange}
      windowScrollerProps={{ scrollElement: scrollableRef }}
      className={clsx(styles.table, {
        [styles.showCategorizeColumn]: enableMultipleCategorization,
      })}
    />
  );
}

export const AccountTransactionsUncategorizedTable = compose(
  withSettings(({ cashflowTransactionsSettings }) => ({
    cashflowTansactionsTableSize: cashflowTransactionsSettings?.tableSize,
  })),
  withBankingActions,
  withBanking(
    ({ openMatchingTransactionAside, enableMultipleCategorization }) => ({
      openMatchingTransactionAside,
      enableMultipleCategorization,
    }),
  ),
)(AccountTransactionsDataTable);
