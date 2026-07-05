// @ts-nocheck
import { Form } from 'formik';
import React from 'react';
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
