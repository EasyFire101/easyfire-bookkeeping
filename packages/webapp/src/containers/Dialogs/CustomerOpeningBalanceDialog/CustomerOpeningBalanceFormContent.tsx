// @ts-nocheck
import React from 'react';
import { Form } from 'formik';

import { CustomerOpeningBalanceFields } from './CustomerOpeningBalanceFields';
import { CustomerOpeningBalanceFormFloatingActions } from './CustomerOpeningBalanceFormFloatingActions';

/**
 * Customer Opening balance form content.
 * @returns
 */
export function CustomerOpeningBalanceFormContent() {
  return (
    <Form>
      <CustomerOpeningBalanceFields />
      <CustomerOpeningBalanceFormFloatingActions />
    </Form>
  );
}
