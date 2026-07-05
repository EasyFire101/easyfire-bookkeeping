// @ts-nocheck
import { Form } from 'formik';
import React from 'react';
import { CurrencyFormFields } from './CurrencyFormFields';
import { CurrencyFormFooter } from './CurrencyFormFooter';

export function CurrencyFormContent() {
  return (
    <Form>
      <CurrencyFormFields />
      <CurrencyFormFooter />
    </Form>
  );
}
