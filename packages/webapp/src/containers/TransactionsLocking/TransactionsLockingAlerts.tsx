// @ts-nocheck
import React from 'react';

const cancelUnlockingPartialAlert = React.lazy(() => import('@/containers/Alerts/TransactionLocking/cancelUnlockingPartialAlert').then(m => ({ default: m.cancelUnlockingPartialAlert })));

/**
 * Transactions alerts.
 */
export const TransactionsLockingAlerts = [
  {
    name: 'cancel-unlocking-partail',
    component: cancelUnlockingPartialAlert,
  },
];
