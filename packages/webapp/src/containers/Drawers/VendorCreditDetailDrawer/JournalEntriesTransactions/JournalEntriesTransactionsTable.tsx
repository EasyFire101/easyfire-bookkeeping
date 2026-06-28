import React from 'react';
import { Card } from '@/components';
import { useVendorCreditDetailDrawerContext } from '../VendorCreditDetailDrawerProvider';
import { useTransactionsByReference } from '@/hooks/query';
import { useJournalEntriesTransactionsColumns } from './components';
import {
  AmountDisplayedBaseCurrencyMessage,
  JournalEntriesTable,
} from '@/containers/JournalEntriesTable/JournalEntriesTable';

/**
 * Journal entries vendor credit transactions table.
 */
export function VendorCreditGLEntriesTable() {
  const { vendorCreditId } = useVendorCreditDetailDrawerContext();
  const columns = useJournalEntriesTransactionsColumns();

  // Handle fetch transaction by reference.
  const { data, isLoading: isTransactionLoading } = useTransactionsByReference(
    {
      referenceId: vendorCreditId ?? 0,
      referenceType: 'vendorCredit',
    },
    { enabled: !!vendorCreditId },
  );
  const transactions = data?.transactions ?? [];

  return (
    <Card>
      <AmountDisplayedBaseCurrencyMessage />
      <JournalEntriesTable
        columns={columns}
        transactions={transactions}
        loading={isTransactionLoading}
      />
    </Card>
  );
}
