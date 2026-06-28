import React from 'react';
import styled from 'styled-components';
import { Card } from '@/components';
import { useTransactionsByReference } from '@/hooks/query';
import { useReceiptDetailDrawerContext } from './ReceiptDetailDrawerProvider';
import {
  AmountDisplayedBaseCurrencyMessage,
  JournalEntriesTable,
} from '../../JournalEntriesTable/JournalEntriesTable';

/**
 * Receipt details GL entries panel.
 */
export function ReceiptDetailsGLEntriesPanel() {
  // Receipt details drawer context.
  const { receiptId } = useReceiptDetailDrawerContext();

  // Handle fetch transaction by reference.
  const { data, isLoading: isTransactionLoading } = useTransactionsByReference(
    {
      referenceId: receiptId as number,
      referenceType: 'SaleReceipt',
    },
    { enabled: !!receiptId },
  );
  const transactions = data?.transactions ?? [];

  return (
    <ReceiptGLEntriesRoot>
      <AmountDisplayedBaseCurrencyMessage />
      <JournalEntriesTable
        loading={isTransactionLoading}
        transactions={transactions}
      />
    </ReceiptGLEntriesRoot>
  );
}

const ReceiptGLEntriesRoot = styled(Card)``;
