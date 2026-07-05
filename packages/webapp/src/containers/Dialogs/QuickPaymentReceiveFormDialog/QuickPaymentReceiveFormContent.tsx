// @ts-nocheck
import { Form } from 'formik';
import React from 'react';
import { QuickPaymentReceiveFloatingActions } from './QuickPaymentReceiveFloatingActions';
import { QuickPaymentReceiveFormFields } from './QuickPaymentReceiveFormFields';

/**
 * Quick payment receive form content.
 */
export function QuickPaymentReceiveFormContent() {
  return (
    <Form>
      <QuickPaymentReceiveFormFields />
      <QuickPaymentReceiveFloatingActions />
    </Form>
  );
}
