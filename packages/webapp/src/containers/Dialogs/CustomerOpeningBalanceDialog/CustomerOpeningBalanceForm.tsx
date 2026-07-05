// @ts-nocheck
import { Intent } from '@blueprintjs/core';
import { Formik } from 'formik';
import { defaultTo } from 'lodash';
import moment from 'moment';
import React from 'react';
import intl from 'react-intl-universal';
import { CreateCustomerOpeningBalanceFormSchema } from './CustomerOpeningBalanceForm.schema';
import { CustomerOpeningBalanceFormContent } from './CustomerOpeningBalanceFormContent';
import { useCustomerOpeningBalanceContext } from './CustomerOpeningBalanceFormProvider';
import { AppToaster } from '@/components';
import { withDialogActions } from '@/containers/Dialog/withDialogActions';
import { compose } from '@/utils';



const defaultInitialValues = {
  opening_balance: '0',
  opening_balance_branch_id: '',
  opening_balance_exchange_rate: 1,
  opening_balance_at: moment(new Date()).format('YYYY-MM-DD'),
};

/**
 * Customer Opening balance form.
 * @returns
 */
function CustomerOpeningBalanceFormInner({
  // #withDialogActions
  closeDialog,
}) {
  const { dialogName, customer, editCustomerOpeningBalanceMutate } =
    useCustomerOpeningBalanceContext();

  // Initial form values
  const initialValues = {
    ...defaultInitialValues,
    ...customer,
    opening_balance: defaultTo(customer.opening_balance, ''),
  };

  // Handles the form submit.
  const handleFormSubmit = (values, { setSubmitting, setErrors }) => {
    const formValues = {
      ...values,
      opening_balance_at: moment(values.opening_balance_at).format(
        'YYYY-MM-DD',
      ),
    };

    // Handle request response success.
    const onSuccess = (response) => {
      AppToaster.show({
        message: intl.get('customer_opening_balance.success_message'),
        intent: Intent.SUCCESS,
      });
      closeDialog(dialogName);
    };

    // Handle request response errors.
    const onError = ({ data: { errors } }) => {
      if (errors) {
      }
      setSubmitting(false);
    };

    editCustomerOpeningBalanceMutate([customer.id, formValues])
      .then(onSuccess)
      .catch(onError);
  };

  return (
    <Formik
      validationSchema={CreateCustomerOpeningBalanceFormSchema}
      initialValues={initialValues}
      onSubmit={handleFormSubmit}
      component={CustomerOpeningBalanceFormContent}
    />
  );
}

export const CustomerOpeningBalanceForm = compose(withDialogActions)(
  CustomerOpeningBalanceFormInner,
);
