// @ts-nocheck
import { Form } from 'formik';
import React from 'react';
import { VendorOpeningBalanceFormFields } from './VendorOpeningBalanceFormFields';
import { VendorOpeningBalanceFormFloatingActions } from './VendorOpeningBalanceFormFloatingActions';

/**
 * Vendor Opening balance form content.
 * @returns
 */
export function VendorOpeningBalanceFormContent() {
  return (
    <Form>
      <VendorOpeningBalanceFormFields />
      <VendorOpeningBalanceFormFloatingActions />
    </Form>
  );
}
