import React from 'react';
import { Classes } from '@blueprintjs/core';

import { MoneyInContentFields } from './MoneyInContentFields';
import { TransactionTypeFields } from './TransactionTypeFields';
import { useMoneyInDailogContext } from './MoneyInDialogProvider';

/**
 * Money in form fields.
 */
export function MoneyInFormFields() {
  const { defaultAccountId } = useMoneyInDailogContext();

  return (
    <div className={Classes.DIALOG_BODY}>
      {!defaultAccountId && <TransactionTypeFields />}
      <MoneyInContentFields />
    </div>
  );
}
