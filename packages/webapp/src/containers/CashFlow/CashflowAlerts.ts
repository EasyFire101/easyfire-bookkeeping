// @ts-nocheck
import React from 'react';

const UncategorizeTransactionAlert = React.lazy(() => import('./UncategorizeTransactionAlert/UncategorizeTransactionAlert').then(m => ({ default: m.UncategorizeTransactionAlert })));

/**
 * Cashflow alerts.
 */
export const CashflowAlerts = [
  {
    name: 'cashflow-tranaction-uncategorize',
    component: UncategorizeTransactionAlert,
  },
];
