// @ts-nocheck
import { Form } from 'formik';
import React from 'react';
import { WarehouseFormFields } from './WarehouseFormFields';
import { WarehouseFormFloatingActions } from './WarehouseFormFloatingActions';

/**
 * Warehouse form content.
 * @returns
 */
export function WarehouseFormContent() {
  return (
    <Form>
      <WarehouseFormFields />
      <WarehouseFormFloatingActions />
    </Form>
  );
}
