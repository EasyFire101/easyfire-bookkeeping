// @ts-nocheck
import React from 'react';

import { TransactionsLockingProvider } from './TransactionsLockingProvider';
import { TransactionsLockingListPage as TransactionsLockingList } from './TransactionsLockingList';

export function TransactionsLockingPage() {
  return (
    <TransactionsLockingProvider>
      <TransactionsLockingList />
    </TransactionsLockingProvider>
  );
}
