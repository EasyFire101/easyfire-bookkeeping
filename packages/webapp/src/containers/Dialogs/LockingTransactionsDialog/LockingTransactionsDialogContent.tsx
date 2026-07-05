// @ts-nocheck
import React from 'react';
import { LockingTransactionsForm } from './LockingTransactionsForm';
import { LockingTransactionsFormProvider } from './LockingTransactionsFormProvider';

/**
 * Locking transactions dialog content.
 */
export function LockingTransactionsDialogContent({
  // #ownProps
  dialogName,
  moduleName,
  isEnabled,
}) {
  return (
    <LockingTransactionsFormProvider
      isEnabled={isEnabled}
      moduleName={moduleName}
      dialogName={dialogName}
    >
      <LockingTransactionsForm />
    </LockingTransactionsFormProvider>
  );
}
