// @ts-nocheck
import { Form } from 'formik';
import React from 'react';
import { RefundVendorCreditFloatingActions } from './RefundVendorCreditFloatingActions';
import { RefundVendorCreditFormFields } from './RefundVendorCreditFormFields';

export function RefundVendorCreditFormContent() {
  return (
    <Form>
      <RefundVendorCreditFormFields />
      <RefundVendorCreditFloatingActions />
    </Form>
  );
}
