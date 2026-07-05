// @ts-nocheck
import React from 'react';
import { UnlockingPartialTransactionsForm } from './UnlockingPartialTransactionsForm';
import { UnlockingPartialTransactionsFormProvider } from './UnlockingPartialTransactionsFormProvider';

/**
 * Unlocking partail transactions dialog content.
 */
export function UnlockingPartialTransactionsDialogContent({
  // #ownProps
  moduleName,
  dialogName,
}) {
  return (
    <UnlockingPartialTransactionsFormProvider
      moduleName={moduleName}
      dialogName={dialogName}
    >
      <UnlockingPartialTransactionsForm />
    </UnlockingPartialTransactionsFormProvider>
  );
}
