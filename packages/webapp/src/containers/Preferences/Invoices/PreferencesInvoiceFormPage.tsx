// @ts-nocheck
import { Intent } from '@blueprintjs/core';
import { Formik } from 'formik';
import * as R from 'ramda';
import React, { useEffect } from 'react';
import intl from 'react-intl-universal';
import { transferObjectOptionsToArray } from '../Accountant/utils';
import { PreferencesInvoiceFormSchema } from './PreferencesInvoiceForm.schema';
import { PreferencesInvoicesForm } from './PreferencesInvoicesForm';
import { AppToaster } from '@/components';
import { withDashboardActions } from '@/containers/Dashboard/withDashboardActions';
import { withSettings } from '@/containers/Settings/withSettings';
import { useSaveSettings } from '@/hooks/query';
import { compose, transformToForm, transfromToSnakeCase } from '@/utils';

const defaultValues = {
  termsConditions: '',
  customerNotes: '',
};

/**
 * Preferences - Invoices.
 */
function PreferencesInvoiceFormPageInner({
  // #withDashboardActions
  changePreferencesPageTitle,

  // #withSettings
  invoiceSettings,
}) {
  // Save settings.
  const { mutateAsync: saveSettingMutate } = useSaveSettings();

  useEffect(() => {
    changePreferencesPageTitle(intl.get('preferences.invoices'));
  }, [changePreferencesPageTitle]);

  // Initial values.
  const initialValues = {
    ...defaultValues,
    ...transformToForm(invoiceSettings, defaultValues),
  };
  // Handle the form submit.
  const handleFormSubmit = (values, { setSubmitting }) => {
    const options = R.compose(
      transferObjectOptionsToArray,
      transfromToSnakeCase,
    )({ salesInvoices: { ...values } });

    // Handle request success.
    const onSuccess = () => {
      AppToaster.show({
        message: intl.get('preferences.invoices.success_message'),
        intent: Intent.SUCCESS,
      });
      setSubmitting(false);
    };
    // Handle request error.
    const onError = () => {
      setSubmitting(false);
    };
    saveSettingMutate({ options }).then(onSuccess).catch(onError);
  };

  return (
    <Formik
      initialValues={initialValues}
      validationSchema={PreferencesInvoiceFormSchema}
      onSubmit={handleFormSubmit}
      component={PreferencesInvoicesForm}
    />
  );
}

export const PreferencesInvoiceFormPage = compose(
  withDashboardActions,
  withSettings(({ invoiceSettings }) => ({
    invoiceSettings: invoiceSettings,
  })),
)(PreferencesInvoiceFormPageInner);
