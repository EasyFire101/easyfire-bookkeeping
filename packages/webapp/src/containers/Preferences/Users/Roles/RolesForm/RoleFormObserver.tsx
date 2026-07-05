// @ts-nocheck
import { useFormikContext } from 'formik';
import React from 'react';
import { FormikObserver } from '@/components';

/**
 * Role form observer.
 * @returns {React.JSX}
 */
export function RoleFormObserver() {
  const { values } = useFormikContext();

  // Handles the form change.
  const handleFormChange = () => {};

  return <FormikObserver onChange={handleFormChange} values={values} />;
}
