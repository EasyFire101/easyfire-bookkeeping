// @ts-nocheck
import React from 'react';
import { Form } from 'formik';

import { UnlockingPartialTransactionsFormFields } from './UnlockingPartialTransactionsFormFields';
import { UnlockingPartialTransactionsFormFloatingActions } from './UnlockingPartialTransactionsFormFloatingActions';

/**
 * Partial Unlocking trsnactions form content.
 */
export function PartialUnlockingTransactionsFormContent() {
  return (
    <Form>
      <UnlockingPartialTransactionsFormFields />
      <UnlockingPartialTransactionsFormFloatingActions />
    </Form>
  );
}
