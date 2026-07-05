// @ts-nocheck
import * as R from 'ramda';
import React from 'react';
import styled from 'styled-components';
import { Card, DrawerLoading } from '@/components';
import { DRAWERS } from '@/constants/drawers';
import { CustomerFormFormik } from '@/containers/Customers/CustomerForm/CustomerFormFormik';
import {
  CustomerFormProvider,
  useCustomerFormContext,
} from '@/containers/Customers/CustomerForm/CustomerFormProvider';
import { withDrawerActions } from '@/containers/Drawer/withDrawerActions';
import { useAddAutofillRef } from '@/hooks/state/autofill';

/**
 * Drawer customer form loading wrapper.
 * @returns {JSX}
 */
function DrawerCustomerFormLoading({ children }) {
  const { isFormLoading } = useCustomerFormContext();

  return <DrawerLoading loading={isFormLoading}>{children}</DrawerLoading>;
}

/**
 * Quick customer form of the drawer.
 */
function QuickCustomerFormDrawerInner({
  displayName,
  autofillRef,
  closeDrawer,
  customerId,
}) {
  const addAutofillRef = useAddAutofillRef();

  // Handle the form submit request success.
  const handleSubmitSuccess = (values, formArgs, submitPayload, res) => {
    if (autofillRef) {
      addAutofillRef(autofillRef, {
        displayName: values.display_name,
        customerId: res.id,
      });
    }
    closeDrawer(DRAWERS.QUICK_CREATE_CUSTOMER);
  };
  // Handle the form cancel action.
  const handleCancelForm = () => {
    closeDrawer(DRAWERS.QUICK_CREATE_CUSTOMER);
  };

  return (
    <CustomerFormProvider customerId={customerId}>
      <DrawerCustomerFormLoading>
        <CustomerFormFormik
          initialValues={{ first_name: displayName }}
          onSubmitSuccess={handleSubmitSuccess}
          onCancel={handleCancelForm}
        />
      </DrawerCustomerFormLoading>
    </CustomerFormProvider>
  );
}

export const QuickCustomerFormDrawer = R.compose(withDrawerActions)(
  QuickCustomerFormDrawerInner,
);
