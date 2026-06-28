import React from 'react';
import styled from 'styled-components';

import { Card } from '@/components';

import { useTransactionsByReference } from '@/hooks/query';
import { useBillDrawerContext } from './BillDrawerProvider';

import {
  AmountDisplayedBaseCurrencyMessage,
  JournalEntriesTable,
} from '../../JournalEntriesTable/JournalEntriesTable';

/**
 * Bill GL entries table.
 * @returns {React.JSX}
 */
export function BillGLEntriesTable() {
  const { billId } = useBillDrawerContext();

  // Handle fetch transaction by reference.
  const { data, isLoading: isTransactionLoading } = useTransactionsByReference(
    {
      referenceId: billId as number,
      referenceType: 'Bill',
    },
    { enabled: !!billId },
  );
  const transactions = data?.transactions ?? [];

  return (
    <BilleGLEntriesRoot>
      <AmountDisplayedBaseCurrencyMessage />
      <BillGLEntriesDatatable
        loading={isTransactionLoading}
        transactions={transactions}
      />
    </BilleGLEntriesRoot>
  );
}

const BilleGLEntriesRoot = styled(Card)``;

const BillGLEntriesDatatable = styled(JournalEntriesTable)`
  .table .tbody .tr:last-child .td {
    border-bottom: 0;
  }
`;
