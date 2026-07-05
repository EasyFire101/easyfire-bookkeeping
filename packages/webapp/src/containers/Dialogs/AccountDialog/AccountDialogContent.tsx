// @ts-nocheck
import React from 'react';
import { AccountDialogForm } from './AccountDialogForm';
import { AccountDialogProvider } from './AccountDialogProvider';

/**
 * Account dialog content.
 */
export function AccountDialogContent({ dialogName, payload }) {
  return (
    <AccountDialogProvider dialogName={dialogName} payload={payload}>
      <AccountDialogForm />
    </AccountDialogProvider>
  );
}
