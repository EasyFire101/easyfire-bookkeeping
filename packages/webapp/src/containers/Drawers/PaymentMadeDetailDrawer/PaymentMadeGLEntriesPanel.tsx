import React from 'react';
import styled from 'styled-components';

import { Card } from '@/components';
import {
  AmountDisplayedBaseCurrencyMessage,
  JournalEntriesTable,
} from '../../JournalEntriesTable/JournalEntriesTable';

import { useTransactionsByReference } from '@/hooks/query';
import { usePaymentMadeDetailContext } from './PaymentMadeDetailProvider';

/**
 * Payment made GL entries table panel.
 */
export function PaymentMadeGLEntriesPanel() {
  const { paymentMadeId } = usePaymentMadeDetailContext();

  // Handle fetch transaction by reference.
  const { data, isLoading: isTransactionsLoading } = useTransactionsByReference(
    {
      referenceId: paymentMadeId as number,
      referenceType: 'BillPayment',
    },
    { enabled: !!paymentMadeId },
  );
  const transactions = data?.transactions ?? [];

  return (
    <PaymentMadeGLEntriesRoot>
      <AmountDisplayedBaseCurrencyMessage />
      <JournalEntriesTable
        loading={isTransactionsLoading}
        transactions={transactions}
      />
    </PaymentMadeGLEntriesRoot>
  );
}

const PaymentMadeGLEntriesRoot = styled(Card)``;
