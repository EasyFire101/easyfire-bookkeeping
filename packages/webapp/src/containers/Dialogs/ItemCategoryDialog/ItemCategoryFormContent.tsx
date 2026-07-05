// @ts-nocheck
import { Form } from 'formik';
import React from 'react';
import { ItemCategoryFormFields } from './ItemCategoryFormFields';
import { ItemCategoryFormFooter } from './ItemCategoryFormFooter';

export function ItemCategoryForm() {
  return (
    <Form>
      <ItemCategoryFormFields />
      <ItemCategoryFormFooter />
    </Form>
  );
}
