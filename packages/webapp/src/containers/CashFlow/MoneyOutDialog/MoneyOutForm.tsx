// @ts-nocheck
import React from 'react';
import intl from 'react-intl-universal';
import moment from 'moment';
import { Intent } from '@blueprintjs/core';
import { Formik } from 'formik';
import { omit } from 'lodash';

import '@/style/pages/CashFlow/CashflowTransactionForm.scss';

import { AppToaster } from '@/components';

import { MoneyOutFormContent } from './MoneyOutFormContent';
import { CreateMoneyOutSchema } from './MoneyOutForm.schema';

import { useMoneyOutDialogContext } from './MoneyOutDialogProvider';

import { withSettings } from '@/containers/Settings/withSettings';
import { withDialogActions } from '@/containers/Dialog/withDialogActions';
import { useCurrentOrganizationBaseCurrency } from '@/hooks/query';

import { compose, transactionNumber } from '@/utils';

const defaultInitialValues = {
  date: moment(new Date()).format('YYYY-MM-DD'),
  amount: '',
  transaction_number: '',
  transaction_type: '',
  reference_no: '',
  cashflow_account_id: '',
  credit_account_id: '',
  description: '',
  publish: '',
  exchange_rate: 1,
};

function MoneyOutFormInner({
  // #withDialogActions
  closeDialog,

  // #withSettings
  transactionNextNumber,
  transactionNumberPrefix,
  transactionIncrementMode,
}) {
  const baseCurrency = useCurrentOrganizationBaseCurrency();

  const {
    dialogName,
    accountId,
    accountType,
    createCashflowTransactionMutate,
  } = useMoneyOutDialogContext();

  // transaction number.
  const transactionNo = transactionNumber(
    transactionNumberPrefix,
    transactionNextNumber,
  );

  // Initial form values.
  const initialValues = {
    ...defaultInitialValues,
    currency_code: baseCurrency,
    transaction_type: accountType,
    ...(transactionIncrementMode && {
      transaction_number: transactionNo,
    }),
    cashflow_account_id: accountId,
  };

  // Handles the form submit.
  const handleFormSubmit = (values, { setSubmitting, setErrors }) => {
    const form = {
      ...omit(values, ['currency_code']),
      publish: true,
    };
    setSubmitting(true);
    createCashflowTransactionMutate(form)
      .then(() => {
        closeDialog(dialogName);

        AppToaster.show({
          message: intl.get('cash_flow_transaction_success_message'),
          intent: Intent.SUCCESS,
        });
      })
      .finally(() => {
        setSubmitting(false);
      });
  };
  return (
    <Formik
      validationSchema={CreateMoneyOutSchema}
      initialValues={initialValues}
      onSubmit={handleFormSubmit}
    >
      <MoneyOutFormContent />
    </Formik>
  );
}

export const MoneyOutForm = compose(
  withDialogActions,
  withSettings(({ cashflowSetting }) => ({
    transactionNextNumber: cashflowSetting?.nextNumber,
    transactionNumberPrefix: cashflowSetting?.numberPrefix,
    transactionIncrementMode: cashflowSetting?.autoIncrement,
  })),
)(MoneyOutFormInner);
