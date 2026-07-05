// @ts-nocheck
import { Form } from 'formik';
import React from 'react';
import { LockingTransactionsFormFields } from './LockingTransactionsFormFields';
import { LockingTransactionsFormFloatingActions } from './LockingTransactionsFormFloatingActions';

/**
 * locking Transactions form content.
 */
export function LockingTransactionsFormContent() {
  return (
    <Form>
      <LockingTransactionsFormFields />
      <LockingTransactionsFormFloatingActions />
    </Form>
  );
}
