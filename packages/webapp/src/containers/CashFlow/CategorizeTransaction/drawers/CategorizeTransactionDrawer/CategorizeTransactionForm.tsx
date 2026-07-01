import React from 'react';
import { Formik, Form, FormikHelpers } from 'formik';
import { Intent } from '@blueprintjs/core';
import { useMutation } from '@tanstack/react-query';
import styled from 'styled-components';
import { categorizeTransactionsBulk } from '@bigcapital/sdk-ts';
import type { CategorizeTransactionBody } from '@bigcapital/sdk-ts';
import { useApiFetcher } from '@/hooks/useRequest';
import { CreateCategorizeTransactionSchema } from './CategorizeTransactionForm.schema';
import { CategorizeTransactionFormContent } from './CategorizeTransactionFormContent';
import { CategorizeTransactionFormFooter } from './CategorizeTransactionFormFooter';
import {
  tranformToRequest,
  useCategorizeTransactionFormInitialValues,
} from './_utils';
import type { CategorizeTransactionFormValues } from './_utils';
import { withBankingActions } from '@/containers/CashFlow/withBankingActions';
import type { WithBankingActionsProps } from '@/containers/CashFlow/withBankingActions';
import { AppToaster } from '@/components';
import { useCategorizeTransactionTabsBoot } from '@/containers/CashFlow/CategorizeTransactionAside/CategorizeTransactionTabsBoot';
import { compose } from '@/utils';

interface CategorizeTransactionFormRootProps
  extends Pick<WithBankingActionsProps, 'closeMatchingTransactionAside'> {}

/**
 * Categorize cashflow transaction form dialog content.
 */
function CategorizeTransactionFormRoot({
  // #withBankingActions
  closeMatchingTransactionAside,
}: CategorizeTransactionFormRootProps) {
  const { uncategorizedTransactionIds } = useCategorizeTransactionTabsBoot();
  const fetcher = useApiFetcher();
  const { mutateAsync: categorizeBulk } = useMutation<
    void,
    Error,
    CategorizeTransactionBody
  >({
    mutationFn: (body) => categorizeTransactionsBulk(fetcher, body),
  });

  // Form initial values in create and edit mode.
  const initialValues = useCategorizeTransactionFormInitialValues();

  // Callbacks handles form submit.
  const handleFormSubmit = (
    values: CategorizeTransactionFormValues,
    { setSubmitting, setErrors }: FormikHelpers<CategorizeTransactionFormValues>,
  ) => {
    const _values = tranformToRequest(values, uncategorizedTransactionIds);

    setSubmitting(true);
    categorizeBulk(_values)
      .then(() => {
        setSubmitting(false);

        AppToaster.show({
          message: 'The uncategorized transaction has been categorized.',
          intent: Intent.SUCCESS,
        });
        closeMatchingTransactionAside();
      })
      .catch((err: { response?: { data?: { errors?: Array<{ type: string }> } } }) => {
        setSubmitting(false);
        if (
          err.response?.data?.errors?.some(
            (e) => e.type === 'BRANCH_ID_REQUIRED',
          )
        ) {
          setErrors({
            ...({} as CategorizeTransactionFormValues),
            branchId: 'The branch is required.',
          });
        } else {
          AppToaster.show({
            message: 'Something went wrong!',
            intent: Intent.DANGER,
          });
        }
      });
  };

  return (
    <Formik
      validationSchema={CreateCategorizeTransactionSchema}
      initialValues={initialValues}
      onSubmit={handleFormSubmit}
    >
      <FormRoot>
        <CategorizeTransactionFormContent />
        <CategorizeTransactionFormFooter />
      </FormRoot>
    </Formik>
  );
}

export const CategorizeTransactionForm = compose(withBankingActions)(
  CategorizeTransactionFormRoot,
);

const FormRoot = styled(Form)`
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;

  .bp4-form-group .bp4-form-content {
    flex: 1 0;
  }
  .bp4-form-group .bp4-label {
    width: 140px;
  }
  .bp4-form-group {
    margin-bottom: 18px;
  }
`;
