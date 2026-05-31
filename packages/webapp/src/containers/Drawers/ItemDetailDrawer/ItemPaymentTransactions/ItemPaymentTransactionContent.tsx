// @ts-nocheck
import React from 'react';
import { index as InvoicePaymentTransactions } from './InvoicePaymentTransactions';
import { index as EstimatePaymentTransactions } from './EstimatePaymentTransactions';
import { index as ReceiptPaymentTransactions } from './ReceiptPaymentTransactions';
import { index as BillPaymentTransactions } from './BillPaymentTransactions';

export function ItemPaymentTransactionsContent({ tansactionType }) {
  const handleType = () => {
    switch (tansactionType) {
      case 'invoices':
      default:
        return <InvoicePaymentTransactions />;
      case 'estimates':
        return <EstimatePaymentTransactions />;
      case 'receipts':
        return <ReceiptPaymentTransactions />;
      case 'bills':
        return <BillPaymentTransactions />;
    }
  };
  return handleType();
}
