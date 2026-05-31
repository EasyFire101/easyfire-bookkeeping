// @ts-nocheck
import React from 'react';

const AccountDeleteTransactionAlert = React.lazy(() => import('@/containers/Alerts/CashFlow/AccountDeleteTransactionAlert').then(m => ({ default: m.AccountDeleteTransactionAlert })));

/**
 * Account transaction alert.
 */
export const AccountTransactionsAlerts = [
  {
    name: 'account-transaction-delete',
    component: AccountDeleteTransactionAlert,
  },
];
