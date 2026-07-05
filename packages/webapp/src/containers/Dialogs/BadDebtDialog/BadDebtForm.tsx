// @ts-nocheck

import { Intent } from '@blueprintjs/core';
import { Formik } from 'formik';
import { omit } from 'lodash';
import React from 'react';
import intl from 'react-intl-universal';
import { CreateBadDebtFormSchema } from './BadDebtForm.schema';
import { BadDebtFormContent } from './BadDebtFormContent';
import { useBadDebtContext } from './BadDebtFormProvider';
import { transformErrors } from './utils';
import { AppToaster } from '@/components';
import { withDialogActions } from '@/containers/Dialog/withDialogActions';
import { useCurrentOrganizationBaseCurrency } from '@/hooks/query';
import { compose } from '@/utils';

const defaultInitialValues = {
  expense_account_id: '',
  reason: '',
  amount: '',
};

function BadDebtFormInner({
  // #withDialogActions
  closeDialog,
}) {
  const baseCurrency = useCurrentOrganizationBaseCurrency();
  const { invoice, dialogName, createBadDebtMutate } = useBadDebtContext();

  // Initial form values
  const initialValues = {
    ...defaultInitialValues,
    amount: invoice?.due_amount || '',
  };

  // Handles the form submit.
  const handleFormSubmit = (values, { setSubmitting, setErrors }) => {
    const form = {
      ...omit(values, ['currency_code']),
    };

    // Handle request response success.
    const onSuccess = (response) => {
      AppToaster.show({
        message: intl.get('bad_debt.dialog.success_message'),
        intent: Intent.SUCCESS,
      });
      closeDialog(dialogName);
    };

    // Handle request response errors.
    const onError = ({ data: { errors } }) => {
      if (errors) {
        transformErrors(errors, { setErrors });
      }
      setSubmitting(false);
    };
    createBadDebtMutate([invoice?.id, form]).then(onSuccess).catch(onError);
  };

  return (
    <Formik
      validationSchema={CreateBadDebtFormSchema}
      initialValues={initialValues}
      onSubmit={handleFormSubmit}
      component={BadDebtFormContent}
    />
  );
}

export const BadDebtForm = compose(withDialogActions)(BadDebtFormInner);
