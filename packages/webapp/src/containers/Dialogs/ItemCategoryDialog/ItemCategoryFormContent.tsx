// @ts-nocheck
import React from 'react';
import { Form } from 'formik';
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
