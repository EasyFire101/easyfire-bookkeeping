// @ts-nocheck
import React from 'react';
import { Form } from 'formik';
import { RefundVendorCreditFormFields } from './RefundVendorCreditFormFields';
import { RefundVendorCreditFloatingActions } from './RefundVendorCreditFloatingActions';

export function RefundVendorCreditFormContent() {
  return (
    <Form>
      <RefundVendorCreditFormFields />
      <RefundVendorCreditFloatingActions />
    </Form>
  );
}
