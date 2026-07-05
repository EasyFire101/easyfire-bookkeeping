// @ts-nocheck
import { Form } from 'formik';
import React from 'react';
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
