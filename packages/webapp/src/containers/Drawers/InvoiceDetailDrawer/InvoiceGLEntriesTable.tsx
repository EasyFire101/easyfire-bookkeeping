import React from 'react';
import styled from 'styled-components';
import { Card } from '@/components';
import { useTransactionsByReference } from '@/hooks/query';
import { useInvoiceDetailDrawerContext } from './InvoiceDetailDrawerProvider';
import {
  AmountDisplayedBaseCurrencyMessage,
  JournalEntriesTable,
} from '../../JournalEntriesTable/JournalEntriesTable';

/**
 * Invoice GL entries table.
 * @returns {React.JSX}
 */
export function InvoiceGLEntriesTable() {
  const { invoiceId } = useInvoiceDetailDrawerContext();

  // Handle fetch transaction by reference.
  const { data, isLoading: isTransactionLoading } = useTransactionsByReference(
    {
      referenceId: invoiceId as number,
      referenceType: 'SaleInvoice',
    },
    { enabled: !!invoiceId },
  );
  const transactions = data?.transactions ?? [];

  return (
    <InvoiceGLEntriesRoot>
      <AmountDisplayedBaseCurrencyMessage />
      <InvoiceGLEntriesDatatable
        loading={isTransactionLoading}
        transactions={transactions}
      />
    </InvoiceGLEntriesRoot>
  );
}

const InvoiceGLEntriesDatatable = styled(JournalEntriesTable)``;

const InvoiceGLEntriesRoot = styled(Card)``;
